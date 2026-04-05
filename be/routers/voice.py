import os

import httpx
from fastapi import APIRouter, UploadFile, File, HTTPException
from openai import AsyncOpenAI, APIStatusError

from models.schemas import VoiceResponse

router = APIRouter()

APP_ENV = os.getenv("APP_ENV", "development")
WHISPER_URL = os.getenv("WHISPER_URL", "http://localhost:9000")


@router.post("/transcribe", response_model=VoiceResponse)
async def transcribe(file: UploadFile = File(...)):
    audio_bytes = await file.read()

    if APP_ENV == "production":
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        try:
            response = await client.audio.transcriptions.create(
                model="whisper-1",
                file=(file.filename, audio_bytes, file.content_type),
            )
        except APIStatusError as e:
            raise HTTPException(status_code=502, detail=f"OpenAI error: {e.message}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
        return VoiceResponse(transcript=response.text, confidence=1.0)
    else:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{WHISPER_URL}/asr",
                    params={"encode": "true", "task": "transcribe", "output": "json"},
                    files={"audio_file": (file.filename, audio_bytes, file.content_type)},
                )
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Whisper service error: {e.response.status_code}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail="Whisper service unavailable")
        return VoiceResponse(transcript=data.get("text", ""), confidence=1.0)
