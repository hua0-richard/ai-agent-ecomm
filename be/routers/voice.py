from fastapi import APIRouter, UploadFile, File

from models.schemas import VoiceResponse

router = APIRouter()


@router.post("/transcribe", response_model=VoiceResponse)
async def transcribe(file: UploadFile = File(...)):
    # TODO: integrate with OpenAI Whisper API
    return VoiceResponse(transcript="", confidence=0.0)
