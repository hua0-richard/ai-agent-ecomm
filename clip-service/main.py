import io
import os
from functools import lru_cache

import torch
from fastapi import FastAPI, UploadFile, File, Query
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

app = FastAPI(title="CLIP Embedding Service")

MODEL_NAME = os.getenv("CLIP_MODEL_NAME", "wkcn/TinyCLIP-ViT-61M-32-Text-29M-LAION400M")

@lru_cache(maxsize=1)
def _load_model():
    print(f"Loading model {MODEL_NAME}...")
    model = CLIPModel.from_pretrained(MODEL_NAME)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    print("Model loaded.")
    return model, processor

@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_NAME}

@app.get("/embedding/text")
async def get_text_embedding(q: str = Query(..., min_length=1)):
    model, processor = _load_model()
    inputs = processor(text=[q], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        embedding = model.get_text_features(**inputs)
    return {"embedding": embedding[0].tolist()}

@app.post("/embedding/image")
async def get_image_embedding(file: UploadFile = File(...)):
    model, processor = _load_model()
    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        embedding = model.get_image_features(**inputs)
    return {"embedding": embedding[0].tolist()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
