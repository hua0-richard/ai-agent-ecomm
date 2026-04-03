from fastapi import APIRouter, UploadFile, File, Query

from models.schemas import SearchResponse
from embeddings.clip import get_text_embedding, get_image_embedding
from db.vectors import similarity_search

router = APIRouter()


@router.get("/text", response_model=SearchResponse)
async def search_by_text(q: str = Query(..., min_length=1)):
    embedding = get_text_embedding(q)
    results = await similarity_search(embedding)
    return SearchResponse(results=results)


@router.post("/image", response_model=SearchResponse)
async def search_by_image(file: UploadFile = File(...)):
    image_bytes = await file.read()
    embedding = get_image_embedding(image_bytes)
    results = await similarity_search(embedding)
    return SearchResponse(results=results)
