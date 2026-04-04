from fastapi import APIRouter

from models.schemas import ChatRequest, ChatResponse
from tools.agent import get_agent_response

router = APIRouter()


@router.post("/", response_model=ChatResponse)
async def chat(request: ChatRequest):
    reply = await get_agent_response(request.message, request.session_id)
    return ChatResponse(reply=reply)
