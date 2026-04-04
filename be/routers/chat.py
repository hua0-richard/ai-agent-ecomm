import json
from decimal import Decimal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from models.schemas import ChatRequest
from tools.agent import stream_agent_response

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
