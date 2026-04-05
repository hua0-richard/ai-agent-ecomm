from fastapi import APIRouter, UploadFile, File, Query, HTTPException

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
    try:
        embedding = get_image_embedding(image_bytes)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"CLIP service error: {str(e)}")
    try:
        results = await similarity_search(embedding)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
    return SearchResponse(results=results)
