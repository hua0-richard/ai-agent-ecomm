import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from models.schemas import ChatRequest
from tools.agent import stream_agent_response

router = APIRouter()


@router.post("/")
async def chat(request: ChatRequest):
    async def generate():
        async for token in stream_agent_response(request.message, request.session_id):
            yield f"data: {json.dumps({'token': token})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
