import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routers import chat, search, voice
from retrievers.hybrid import warmup

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm the retrievers and models on startup
    warmup()
    yield


app = FastAPI(title="AI E-Commerce Agent", version="0.1.0", lifespan=lifespan)

origins = ["http://localhost:5173"]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    for url in frontend_url.split(","):
        origins.append(url.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(voice.router, prefix="/api/voice", tags=["voice"])


@app.get("/health")
async def health():
    return {"status": "ok"}
