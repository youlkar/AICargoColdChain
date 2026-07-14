"""
Vector store for compliance regulatory knowledge.

Backend selection (checked in order, first available wins — override with
``VECTOR_STORE_BACKEND=azure_search|supabase|mock``):
  1. Azure AI Search  (AZURE_SEARCH_ENDPOINT / AZURE_SEARCH_API_KEY / AZURE_SEARCH_INDEX)
  2. Supabase pgvector (SUPABASE_URL / SUPABASE_KEY)
  3. MockComplianceVectorStore (in-memory, for local dev / tests)

``ComplianceVectorStore`` is a thin dispatcher — callers (tools/compliance_agent.py,
ingest_compliance_docs.py) keep using it unchanged regardless of which backend
is active.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class AzureSearchVectorStore:
    """Azure AI Search-backed vector store. Same interface as the Supabase store."""

    def __init__(self):
        from azure.core.credentials import AzureKeyCredential
        from azure.search.documents import SearchClient

        from tools.helper.embeddings import EmbeddingGenerator

        endpoint = os.environ["AZURE_SEARCH_ENDPOINT"]
        api_key = os.environ["AZURE_SEARCH_API_KEY"]
        self.index_name = os.environ.get("AZURE_SEARCH_INDEX", "compliance-knowledge")

        self.client = SearchClient(
            endpoint=endpoint,
            index_name=self.index_name,
            credential=AzureKeyCredential(api_key),
        )
        self.embedder = EmbeddingGenerator()
        logger.info(
            "Vector store connected (Azure AI Search, index=%s, dim=%d)",
            self.index_name,
            self.embedder.embedding_dim,
        )

    # ── write ────────────────────────────────────────────────────────
    def add_documents(self, chunks: List[Dict]) -> int:
        texts = [c["content"] for c in chunks]
        embeddings = self.embedder.generate_embeddings_batch(texts)
        now = datetime.now(timezone.utc).isoformat()

        documents = []
        for chunk, emb in zip(chunks, embeddings):
            meta = chunk["metadata"]
            documents.append(
                {
                    "id": uuid.uuid4().hex,
                    "regulation_id": chunk["regulation_id"],
                    "regulation_name": meta.get("regulation_name"),
                    "authority": meta.get("authority"),
                    "section": chunk.get("section") or "",
                    "title": chunk.get("title") or "",
                    "content": chunk["content"],
                    "content_vector": emb,
                    "metadata": json.dumps(
                        {**meta, "chunk_index": chunk.get("chunk_index")}
                    ),
                    "embedding_model": self.embedder.model_name,
                    "embedding_dim": self.embedder.embedding_dim,
                    "source_file": meta.get("source_file") or "",
                    "product_categories": meta.get("product_categories") or [],
                    "applies_to": meta.get("applies_to") or [],
                    "created_at": now,
                }
            )

        inserted = 0
        for i in range(0, len(documents), 100):
            batch = documents[i : i + 100]
            try:
                results = self.client.upload_documents(documents=batch)
                inserted += sum(1 for r in results if r.succeeded)
            except Exception as exc:
                logger.error("Batch upload failed: %s", exc)
        return inserted

    # ── search ───────────────────────────────────────────────────────
    def search(
        self,
        query: str,
        limit: int = 5,
        filters: Optional[Dict] = None,
        similarity_threshold: float = 0.3,
    ) -> List[Dict]:
        from azure.search.documents.models import VectorizedQuery

        try:
            query_embedding = self.embedder.generate_embedding(query)
        except Exception as exc:
            logger.error("Embedding generation failed: %s — returning empty results", exc)
            return []

        filter_str = None
        if filters:
            clauses = []
            for key, value in filters.items():
                if isinstance(value, str):
                    clauses.append(f"{key} eq '{value}'")
                else:
                    clauses.append(f"{key} eq {value}")
            filter_str = " and ".join(clauses)

        vector_query = VectorizedQuery(
            vector=query_embedding, k_nearest_neighbors=max(limit * 4, 20), fields="content_vector"
        )

        try:
            results = self.client.search(
                search_text=None,
                vector_queries=[vector_query],
                filter=filter_str,
                top=max(limit * 4, 20),
            )
        except Exception as exc:
            logger.error("Azure Search query failed: %s — returning empty results", exc)
            return []

        parsed = []
        for r in results:
            score = r.get("@search.score", 0.0)
            if score < similarity_threshold:
                continue
            meta = {}
            try:
                meta = json.loads(r.get("metadata") or "{}")
            except (json.JSONDecodeError, TypeError):
                pass
            parsed.append(
                {
                    "regulation_id": r.get("regulation_id"),
                    "regulation_name": r.get("regulation_name"),
                    "authority": r.get("authority"),
                    "section": r.get("section"),
                    "title": r.get("title"),
                    "content": r.get("content"),
                    "similarity": score,
                    "metadata": meta,
                }
            )
        parsed.sort(key=lambda x: x["similarity"], reverse=True)
        return parsed[:limit]

    # ── helpers ──────────────────────────────────────────────────────
    def get_by_regulation_id(self, regulation_id: str) -> List[Dict]:
        results = self.client.search(
            search_text="*",
            filter=f"regulation_id eq '{regulation_id}'",
            top=1000,
        )
        docs = []
        for r in results:
            meta = {}
            try:
                meta = json.loads(r.get("metadata") or "{}")
            except (json.JSONDecodeError, TypeError):
                pass
            docs.append({**r, "metadata": meta})
        return docs

    def delete_all(self):
        ids = [{"id": r["id"]} for r in self.client.search(search_text="*", select=["id"], top=100000)]
        if not ids:
            return
        for i in range(0, len(ids), 1000):
            self.client.delete_documents(documents=ids[i : i + 1000])

    def count_documents(self) -> int:
        return self.client.get_document_count()


class _SupabaseVectorStore:
    """Legacy Supabase pgvector backend."""

    def __init__(self):
        from supabase import create_client

        self.client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
        self.table_name = "compliance_knowledge"

        self.client.table(self.table_name).select("count", count="exact").limit(1).execute()

        from tools.helper.embeddings import EmbeddingGenerator

        self.embedder = EmbeddingGenerator()
        logger.info("Vector store connected (Supabase, dim=%d)", self.embedder.embedding_dim)

    # ── write ────────────────────────────────────────────────────────
    def add_documents(self, chunks: List[Dict]) -> int:
        texts = [c["content"] for c in chunks]
        embeddings = self.embedder.generate_embeddings_batch(texts)

        records = []
        for chunk, emb in zip(chunks, embeddings):
            records.append(
                {
                    "regulation_id": chunk["regulation_id"],
                    "regulation_name": chunk["metadata"].get("regulation_name"),
                    "authority": chunk["metadata"].get("authority"),
                    "section": chunk.get("section"),
                    "title": chunk.get("title"),
                    "content": chunk["content"],
                    "embedding": emb,
                    "metadata": {
                        **chunk["metadata"],
                        "chunk_index": chunk.get("chunk_index"),
                        "source_file": chunk["metadata"].get("source_file"),
                        "embedding_model": self.embedder.model_name,
                        "embedding_dim": self.embedder.embedding_dim,
                    },
                }
            )

        inserted = 0
        for i in range(0, len(records), 100):
            batch = records[i : i + 100]
            try:
                self.client.table(self.table_name).insert(batch).execute()
                inserted += len(batch)
            except Exception as exc:
                logger.error("Batch insert failed: %s", exc)
        return inserted

    # ── search ───────────────────────────────────────────────────────
    def search(
        self,
        query: str,
        limit: int = 5,
        filters: Optional[Dict] = None,
        similarity_threshold: float = 0.3,
    ) -> List[Dict]:
        try:
            query_embedding = self.embedder.generate_embedding(query)
        except Exception as exc:
            logger.error("Embedding generation failed: %s — returning empty results", exc)
            return []

        try:
            resp = self.client.rpc(
                "match_compliance_documents",
                {
                    "query_embedding": query_embedding,
                    "match_threshold": similarity_threshold,
                    "match_count": limit,
                },
            ).execute()
            return resp.data
        except Exception:
            logger.warning("RPC search failed, falling back to brute-force")
            try:
                all_docs = (
                    self.client.table(self.table_name).select("*").limit(1000).execute()
                )
                results = []
                for doc in all_docs.data:
                    try:
                        sim = self.embedder.similarity(query_embedding, doc["embedding"])
                        if sim >= similarity_threshold:
                            results.append({**doc, "similarity": sim})
                    except Exception:
                        continue
                results.sort(key=lambda x: x["similarity"], reverse=True)
                return results[:limit]
            except Exception as exc:
                logger.error("Brute-force search also failed: %s", exc)
                return []

    # ── helpers ──────────────────────────────────────────────────────
    def get_by_regulation_id(self, regulation_id: str) -> List[Dict]:
        return (
            self.client.table(self.table_name)
            .select("*")
            .eq("regulation_id", regulation_id)
            .execute()
            .data
        )

    def delete_all(self):
        self.client.table(self.table_name).delete().neq("id", 0).execute()

    def count_documents(self) -> int:
        resp = self.client.table(self.table_name).select("id", count="exact").execute()
        return resp.count


class ComplianceVectorStore:
    """Dispatches to Azure AI Search, Supabase, or an in-memory mock — same interface either way."""

    def __init__(self):
        backend_override = os.getenv("VECTOR_STORE_BACKEND")

        if backend_override in (None, "azure_search") and os.getenv("AZURE_SEARCH_ENDPOINT"):
            try:
                self._backend = AzureSearchVectorStore()
                return
            except Exception as exc:
                logger.warning("Azure AI Search vector store unavailable: %s", exc)

        if backend_override in (None, "supabase") and os.getenv("SUPABASE_URL"):
            try:
                self._backend = _SupabaseVectorStore()
                return
            except Exception as exc:
                logger.warning("Supabase vector store unavailable: %s", exc)

        logger.info("Using mock vector store (no backend configured or reachable)")
        from tools.helper.mock_vector_store import MockComplianceVectorStore

        self._backend = MockComplianceVectorStore()

    def add_documents(self, chunks: List[Dict]) -> int:
        return self._backend.add_documents(chunks)

    def search(
        self,
        query: str,
        limit: int = 5,
        filters: Optional[Dict] = None,
        similarity_threshold: float = 0.3,
    ) -> List[Dict]:
        return self._backend.search(query, limit, filters, similarity_threshold)

    def get_by_regulation_id(self, regulation_id: str) -> List[Dict]:
        return self._backend.get_by_regulation_id(regulation_id)

    def delete_all(self):
        return self._backend.delete_all()

    def count_documents(self) -> int:
        return self._backend.count_documents()
