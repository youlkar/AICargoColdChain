"""
Embeddings via Azure OpenAI — enterprise-grade, SOC 2 / HIPAA compliant.
Drop-in replacement for the Gemini EmbeddingGenerator.
Interface is identical: generate_embedding(), generate_embeddings_batch(), similarity().
"""
from __future__ import annotations

import logging
import os
from typing import List

import numpy as np
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 768  # dimensions param reduces text-embedding-3-large output to match pgvector column


class EmbeddingGenerator:

    def __init__(self, model_name: str = None):
        from openai import AzureOpenAI
        self.client = AzureOpenAI(
            azure_endpoint=os.environ["AZURE_OPENAI_EMBEDDING_ENDPOINT"],
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            api_version=os.environ.get("AZURE_OPENAI_EMBEDDING_API_VERSION", "2024-06-01"),
        )
        self.model_name = (
            model_name
            or os.environ.get("AZURE_EMBEDDING_DEPLOYMENT", "text-embedding-3-small")
        )
        self.embedding_dim = EMBEDDING_DIM
        logger.info(
            "EmbeddingGenerator ready (Azure OpenAI, model=%s, dim=%d)",
            self.model_name,
            EMBEDDING_DIM,
        )

    def generate_embedding(self, text: str) -> List[float]:
        resp = self.client.embeddings.create(
            input=text,
            model=self.model_name,
            dimensions=EMBEDDING_DIM,
        )
        return resp.data[0].embedding

    def generate_embeddings_batch(
        self, texts: List[str], batch_size: int = 16
    ) -> List[List[float]]:
        logger.info("Generating embeddings for %d texts ...", len(texts))
        results: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            resp = self.client.embeddings.create(
                input=batch,
                model=self.model_name,
                dimensions=EMBEDDING_DIM,
            )
            results.extend(
                [item.embedding for item in sorted(resp.data, key=lambda x: x.index)]
            )
        return results

    def similarity(self, embedding1: List[float], embedding2: List[float]) -> float:
        vec1 = np.array(embedding1)
        vec2 = np.array(embedding2)
        denom = np.linalg.norm(vec1) * np.linalg.norm(vec2)
        if denom == 0:
            return 0.0
        return float(np.dot(vec1, vec2) / denom)
