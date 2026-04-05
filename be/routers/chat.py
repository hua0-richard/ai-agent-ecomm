import json
from decimal import Decimal

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from models.schemas import ChatRequest
from tools.agent import stream_agent_response
import tools.product_search as _product_search_module

router = APIRouter()


def _default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


@router.post("/")
async def chat(request: ChatRequest):
    async def generate():
        try:
            async for event in stream_agent_response(request.message, request.session_id):
                yield f"data: {json.dumps(event, default=_default)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/image")
async def chat_image(file: UploadFile = File(...), session_id: str = Form(None)):
    from embeddings.clip import get_image_embedding
    from db.vectors import similarity_search

    image_bytes = await file.read()
    try:
        embedding = get_image_embedding(image_bytes)
        products = await similarity_search(embedding)
    except Exception as e:
        async def error_gen():
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    # Pre-populate last_products so the agent has them in context if needed
    _product_search_module.last_products = products

    game_names = ", ".join(p.get("name", "") for p in products if p.get("name"))
    message = (
        f"I uploaded an image and a visual similarity search returned these games: {game_names}. "
        f"Tell me about them — what makes each one worth playing, and which would you actually recommend?"
    )

    async def generate():
        try:
            # Emit the image search products immediately so the UI renders cards
            yield f"data: {json.dumps({'type': 'products', 'products': products}, default=_default)}\n\n"
            async for event in stream_agent_response(message, session_id):
                # Suppress any re-emission of products from tool calls — we already sent them
                if event.get("type") == "products":
                    continue
                yield f"data: {json.dumps(event, default=_default)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
