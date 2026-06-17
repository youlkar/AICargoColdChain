# Embeddings via Gemini API — free tier, no local model loaded into RAM
from __future__ import annotations

import logging
import os
from typing import List

import google.generativeai as genai
import numpy as np

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 768  # text-embedding-004 output dimension


class EmbeddingGenerator:

    def __init__(self, model_name: str = "models/text-embedding-004"):
        self.model_name = model_name
        self.embedding_dim = EMBEDDING_DIM
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY environment variable is not set")
        genai.configure(api_key=api_key)
        logger.info("EmbeddingGenerator ready (model=%s, dim=%d)", model_name, EMBEDDING_DIM)

    def generate_embedding(self, text: str) -> List[float]:
        result = genai.embed_content(model=self.model_name, content=text)
        return result["embedding"]

    def generate_embeddings_batch(
        self, texts: List[str], batch_size: int = 32
    ) -> List[List[float]]:
        logger.info("Generating embeddings for %d texts …", len(texts))
        results: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            result = genai.embed_content(model=self.model_name, content=batch)
            embeddings = result["embedding"]
            # API returns list-of-lists for batch, single list for single item
            if embeddings and isinstance(embeddings[0], float):
                embeddings = [embeddings]
            results.extend(embeddings)
        return results

    def similarity(self, embedding1: List[float], embedding2: List[float]) -> float:
        vec1 = np.array(embedding1)
        vec2 = np.array(embedding2)
        denom = np.linalg.norm(vec1) * np.linalg.norm(vec2)
        if denom == 0:
            return 0.0
        return float(np.dot(vec1, vec2) / denom)
