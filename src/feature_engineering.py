"""
Feature engineering for the hybrid risk scoring pipeline.
"""

from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd

ROLLING_WINDOW = 3  # number of preceding windows for rolling stats


def _add_product_reference_cols(
    df: pd.DataFrame, profiles: Dict[str, dict],
) -> pd.DataFrame:
    # Attach product-specific temperature bounds from profiles.
    temp_low = df["product_id"].map({k: v["temp_low"] for k, v in profiles.items()})
    temp_high = df["product_id"].map({k: v["temp_high"] for k, v in profiles.items()})
    temp_crit_low = df["product_id"].map({k: v["temp_critical_low"] for k, v in profiles.items()})
    temp_crit_high = df["product_id"].map({k: v["temp_critical_high"] for k, v in profiles.items()})

    df = df.copy()
    df["prod_temp_low"] = temp_low
    df["prod_temp_high"] = temp_high
    df["prod_temp_mid"] = (temp_low + temp_high) / 2.0
    df["prod_temp_crit_low"] = temp_crit_low
    df["prod_temp_crit_high"] = temp_crit_high
    return df


def engineer_features(
    df: pd.DataFrame,
    profiles: Dict[str, dict],
) -> pd.DataFrame:
    # Add all derived features.
    df = _add_product_reference_cols(df, profiles)
    df = df.sort_values(["leg_id", "window_start"]).reset_index(drop=True)

    # --- point-in-time features ---
    df["temp_deviation"] = (df["avg_temp_c"] - df["prod_temp_mid"]).abs()
    df["temp_breach"] = (
        (df["avg_temp_c"] < df["prod_temp_low"]) |
        (df["avg_temp_c"] > df["prod_temp_high"])
    ).astype(int)
    df["temp_critical_breach"] = (
        (df["avg_temp_c"] < df["prod_temp_crit_low"]) |
        (df["avg_temp_c"] > df["prod_temp_crit_high"])
    ).astype(int)

    dist_low = df["avg_temp_c"] - df["prod_temp_low"]
    dist_high = df["prod_temp_high"] - df["avg_temp_c"]
    df["temp_margin"] = np.minimum(dist_low, dist_high)

    df["window_duration_min"] = (
        (df["window_end"] - df["window_start"]).dt.total_seconds() / 60.0
    )
    df["hour_of_day"] = df["window_start"].dt.hour

    # --- per-leg sequential features ---
    grouped = df.groupby("leg_id", sort=False)

    # Shift by 1 before cumsum so this feature only reflects PAST windows,
    # not the current window.  minutes_outside_range at time T correlates 0.86
    # with the target at T — including it in a cumsum without shifting would
    # partially encode the current-window label into the feature.
    df["cumulative_breach_min"] = (
        grouped["minutes_outside_range"]
        .transform(lambda s: s.shift(1).fillna(0.0).cumsum())
    )
    df["delay_acceleration"] = grouped["current_delay_min"].diff().fillna(0.0)
    df["battery_drain_rate"] = grouped["battery_avg_pct"].diff().fillna(0.0)

    df["rolling_temp_mean_3"] = grouped["avg_temp_c"].transform(
        lambda s: s.rolling(ROLLING_WINDOW, min_periods=1).mean()
    )
    df["rolling_temp_std_3"] = grouped["avg_temp_c"].transform(
        lambda s: s.rolling(ROLLING_WINDOW, min_periods=1).std().fillna(0.0)
    )
    df["rolling_slope_mean_3"] = grouped["temp_slope_c_per_hr"].transform(
        lambda s: s.rolling(ROLLING_WINDOW, min_periods=1).mean()
    )

    # time_in_phase: cumulative minutes within the same transit_phase run
    df["_phase_change"] = grouped["transit_phase"].transform(
        lambda s: (s != s.shift(1)).cumsum()
    )
    df["time_in_phase_min"] = df.groupby(["leg_id", "_phase_change"]).cumcount() * 25.0
    df.drop(columns="_phase_change", inplace=True)

    # leg progress: 0 at first window, 1 at last window of that leg
    leg_counts = grouped["window_id"].transform("count")
    df["leg_progress_pct"] = grouped.cumcount() / (leg_counts - 1).clip(lower=1)

    return df


# ML feature list (excludes leaky / ID / datetime / target columns)

ID_COLS = [
    "window_id", "leg_id", "shipment_id", "container_id", "product_id",
    "window_start", "window_end",
]

LEAKY_COLS = [
    "minutes_outside_range",
    "humidity_avg_pct",
]

TARGET = "target_spoilage_risk_6h"

REFERENCE_COLS = [
    "prod_temp_low", "prod_temp_high", "prod_temp_mid",
    "prod_temp_crit_low", "prod_temp_crit_high",
]

CATEGORICAL_COLS = ["transit_phase", "product_id"]


def get_ml_feature_names(df: pd.DataFrame) -> List[str]:
    # Return the list of columns suitable for ML model input.
    exclude = set(ID_COLS + LEAKY_COLS + REFERENCE_COLS + [TARGET])
    numeric = [
        c for c in df.select_dtypes(include="number").columns
        if c not in exclude
    ]
    return numeric


def prepare_ml_arrays(
    df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.Series, list[str]]:
    # Return (X, y, feature_names) with one-hot encoded categoricals and non-leaky numeric features.
    feature_cols = get_ml_feature_names(df)

    X = df[feature_cols].copy()

    phase_dummies = pd.get_dummies(df["transit_phase"], prefix="phase", dtype=int)
    product_dummies = pd.get_dummies(df["product_id"], prefix="prod", dtype=int)
    X = pd.concat([X, phase_dummies, product_dummies], axis=1)

    y = df[TARGET].copy()
    return X, y, list(X.columns)
