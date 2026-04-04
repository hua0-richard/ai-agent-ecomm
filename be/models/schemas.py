from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


class ChatResponse(BaseModel):
    reply: str


class ProductResult(BaseModel):
    id: int
    name: str
    description: str | None
    price: float
    image_url: str | None
    screenshots: str | None = None
    similarity: float | None = None


class SearchResponse(BaseModel):
    results: list[ProductResult]


class VoiceResponse(BaseModel):
    transcript: str
    confidence: float
