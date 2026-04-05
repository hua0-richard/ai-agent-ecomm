import json
from decimal import Decimal

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from models.schemas import ChatRequest
from tools.agent import stream_agent_response, _match_products_to_response
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

    game_lines = []
    for p in products:
        name = p.get("name", "")
        if not name:
            continue
        genres = p.get("genres") or ""
        tags = p.get("tags") or ""
        def _parse_list(raw: str) -> list[str]:
            if not raw:
                return []
            try:
                parsed = json.loads(raw)
                return [str(x) for x in parsed] if isinstance(parsed, list) else [str(parsed)]
            except Exception:
                return [x.strip() for x in raw.split(",") if x.strip()]

        genre_list = _parse_list(genres)
        tag_list = _parse_list(tags)
        genre_str = ", ".join(genre_list[:3]) if genre_list else "unknown genre"
        tag_str = ", ".join(tag_list[:5]) if tag_list else ""
        app_id = p.get("app_id", "unknown")
        line = f"- {name} (app_id: {app_id}; genres: {genre_str}"
        if tag_str:
            line += f"; tags: {tag_str}"
        line += ")"
        game_lines.append(line)

    game_context = "\n".join(game_lines)
    message = (
        f"I uploaded an image and a visual similarity search already matched it to these {len(game_lines)} games. "
        f"These are ordered by visual similarity — the top ones most closely resemble the image I uploaded:\n\n"
        f"{game_context}\n\n"
        f"DO NOT call product_search_tool — the search is already done. "
        f"Instead, you MUST call show_product_cards with the app_ids of the games you want to recommend to show their cards. "
        f"Just tell me about these games using their EXACT names as listed above. "
        f"Which ones stand out, what's the vibe, and which would you recommend?"
    )

    async def generate():
        try:
            full_response = ""
            async for event in stream_agent_response(message, session_id, history_override="I uploaded an image for visual search."):
                if event.get("type") == "token":
                    full_response += event.get("content", "")
                yield f"data: {json.dumps(event, default=_default)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
