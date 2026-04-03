FROM python:3.11-slim AS base

WORKDIR /app

# System deps for psycopg2-binary and Pillow
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq-dev libjpeg62-turbo-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

# Copy application source
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
