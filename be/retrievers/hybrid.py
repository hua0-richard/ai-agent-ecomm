from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from langchain.retrievers import EnsembleRetriever
from sentence_transformers import CrossEncoder, SentenceTransformer

from db.vectors import get_all_products, text_similarity_search

_bm25: BM25Retriever | None = None
_cross_encoder: CrossEncoder | None = None
_text_model: SentenceTransformer | None = None


def _to_doc(product: dict) -> Document:
    return Document(
        page_content=f"{product['name']}. {product.get('description') or ''}".strip(),
        metadata=product,
    )


def _get_bm25(k: int) -> BM25Retriever:
    global _bm25
    if _bm25 is None:
        docs = [_to_doc(p) for p in get_all_products()]
        _bm25 = BM25Retriever.from_documents(docs, k=k)
    return _bm25


def _get_text_model() -> SentenceTransformer:
    global _text_model
    if _text_model is None:
        _text_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _text_model


def _get_cross_encoder() -> CrossEncoder:
    global _cross_encoder
    if _cross_encoder is None:
        _cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    return _cross_encoder


def _rerank(query: str, docs: list[Document], top_n: int) -> list[Document]:
    if not docs:
        return docs
    scores = _get_cross_encoder().predict([[query, doc.page_content] for doc in docs])
    ranked = sorted(zip(scores, docs), key=lambda x: x[0], reverse=True)
    return [doc for _, doc in ranked[:top_n]]


class _TextVectorRetriever(BaseRetriever):
    k: int = 10

    def _get_relevant_documents(self, query: str) -> list[Document]:
        embedding = _get_text_model().encode(query).tolist()
        return [_to_doc(r) for r in text_similarity_search(embedding, self.k)]


class HybridRetriever(BaseRetriever):
    k: int = 10
    top_n: int = 3

    def _get_relevant_documents(self, query: str) -> list[Document]:
        docs = EnsembleRetriever(
            retrievers=[_get_bm25(self.k), _TextVectorRetriever(k=self.k)],
            weights=[0.4, 0.6],
        ).invoke(query)
        return _rerank(query, docs, self.top_n)

    async def _aget_relevant_documents(self, query: str) -> list[Document]:
        docs = await EnsembleRetriever(
            retrievers=[_get_bm25(self.k), _TextVectorRetriever(k=self.k)],
            weights=[0.4, 0.6],
        ).ainvoke(query)
        return _rerank(query, docs, self.top_n)


def build_hybrid_retriever(k: int = 10, top_n: int = 3) -> HybridRetriever:
    return HybridRetriever(k=k, top_n=top_n)
