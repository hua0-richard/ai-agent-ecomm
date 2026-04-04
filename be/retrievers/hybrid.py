from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain_community.document_compressors.cross_encoder_rerank import CrossEncoderReranker
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from langchain.retrievers import ContextualCompressionRetriever, EnsembleRetriever

from db.vectors import get_all_products, text_similarity_search
from embeddings.clip import get_text_embedding

_bm25: BM25Retriever | None = None
_cross_encoder: HuggingFaceCrossEncoder | None = None


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


def _get_cross_encoder() -> HuggingFaceCrossEncoder:
    global _cross_encoder
    if _cross_encoder is None:
        _cross_encoder = HuggingFaceCrossEncoder(
            model_name="cross-encoder/ms-marco-MiniLM-L-6-v2"
        )
    return _cross_encoder


class _TextVectorRetriever(BaseRetriever):
    k: int = 10

    def _get_relevant_documents(self, query: str) -> list[Document]:
        embedding = get_text_embedding(query)
        return [_to_doc(r) for r in text_similarity_search(embedding, self.k)]


def build_hybrid_retriever(k: int = 10, top_n: int = 3) -> ContextualCompressionRetriever:
    ensemble = EnsembleRetriever(
        retrievers=[_get_bm25(k), _TextVectorRetriever(k=k)],
        weights=[0.4, 0.6],
    )
    compressor = CrossEncoderReranker(model=_get_cross_encoder(), top_n=top_n)
    return ContextualCompressionRetriever(
        base_compressor=compressor,
        base_retriever=ensemble,
    )
