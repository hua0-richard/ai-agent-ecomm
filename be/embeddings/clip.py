import io
import os
from functools import lru_cache

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL_NAME = os.getenv("CLIP_MODEL_NAME", "openai/clip-vit-base-patch32")


@lru_cache(maxsize=1)
def _load_model():
    model = CLIPModel.from_pretrained(MODEL_NAME)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    return model, processor


def get_text_embedding(text: str) -> list[float]:
    model, processor = _load_model()
    inputs = processor(text=[text], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        embedding = model.get_text_features(**inputs)
    return embedding[0].tolist()


def get_image_embedding(image_bytes: bytes) -> list[float]:
    model, processor = _load_model()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        embedding = model.get_image_features(**inputs)
    return embedding[0].tolist()
