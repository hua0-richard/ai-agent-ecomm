import os

import httpx
from fastapi import APIRouter, UploadFile, File

from models.schemas import VoiceResponse

router = APIRouter()

WHISPER_URL = os.getenv("WHISPER_URL", "http://localhost:9000")


@router.post("/transcribe", response_model=VoiceResponse)
async def transcribe(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{WHISPER_URL}/asr",
            params={"encode": "true", "task": "transcribe", "output": "json"},
            files={"audio_file": (file.filename, audio_bytes, file.content_type)},
        )
        response.raise_for_status()
        data = response.json()
    return VoiceResponse(transcript=data.get("text", ""), confidence=1.0)
