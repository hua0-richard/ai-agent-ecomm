import os
import httpx

CLIP_SERVICE_URL = os.getenv("CLIP_SERVICE_URL", "http://clip-service:8001")


def get_text_embedding(text: str) -> list[float]:
    with httpx.Client(timeout=60.0) as client:
        response = client.get(
            f"{CLIP_SERVICE_URL}/embedding/text",
            params={"q": text}
        )
        response.raise_for_status()
        return response.json()["embedding"]


def get_image_embedding(image_bytes: bytes) -> list[float]:
    with httpx.Client(timeout=60.0) as client:
        files = {"file": ("image.jpg", image_bytes, "image/jpeg")}
        response = client.post(
            f"{CLIP_SERVICE_URL}/embedding/image",
            files=files
        )
        response.raise_for_status()
        return response.json()["embedding"]
