from fastapi import APIRouter, UploadFile, File, Query

from models.schemas import SearchResponse, ProductResult
from embeddings.clip import get_image_embedding
from db.vectors import similarity_search
from retrievers.hybrid import build_hybrid_retriever

router = APIRouter()


@router.get("/text", response_model=SearchResponse)
async def search_by_text(q: str = Query(..., min_length=1)):
    retriever = build_hybrid_retriever()
    docs = await retriever.aget_relevant_documents(q)
    results = [ProductResult(**doc.metadata) for doc in docs]
    return SearchResponse(results=results)


@router.post("/image", response_model=SearchResponse)
async def search_by_image(file: UploadFile = File(...)):
    image_bytes = await file.read()
    embedding = get_image_embedding(image_bytes)
    results = await similarity_search(embedding)
    return SearchResponse(results=results)
