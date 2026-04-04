# AI Agent E Commerce Store

Amazon Rufus but for Steam

## Architecture

| Service | Port | Description |
|---------|------|-------------|
| **fe** | 5173 | React + Vite frontend |
| **api** | 8000 | FastAPI backend (chat, search, voice) |
| **clip-service** | 8001 | CLIP image/text embedding service |
| **whisper** | 9000 | OpenAI Whisper speech-to-text |
| **db** | 5432 | PostgreSQL 16 + pgvector |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- An OpenAI API key

## Setup

1. **Clone the repo**

   ```bash
   git clone <repo-url>
   cd ai-agent-ecomm
   ```

2. **Configure environment variables**

   ```bash
   cp be/.env.example be/.env
   ```

   Edit `be/.env` and add your OpenAI API key:

   ```
   OPENAI_API_KEY=sk-your-key-here
   ```

3. **Start all services**

   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

   Wait for all health checks to pass. The clip-service takes ~60s on first start to download the model.

4. **Seed the database**

   In a separate terminal, run the seed script to load the top 5000 Steam games:

   ```bash
   docker compose -f docker-compose.dev.yml exec api python -m migrations.seed
   ```

   This will:
   - Download the Steam games dataset from HuggingFace
   - Insert raw game data into the `games` table
   - Generate sentence embeddings (name + description) using `all-MiniLM-L6-v2`
   - Generate CLIP image embeddings via the clip-service
   - Insert everything into the `products` table

   The text embeddings are batched and fast. Image embeddings take longer (~5000 HTTP requests with image downloads).

5. **Open the app**

   Visit [http://localhost:5173](http://localhost:5173)

## Useful Commands

```bash
# Start services (detached)
docker compose -f docker-compose.dev.yml up --build -d

# View logs
docker compose -f docker-compose.dev.yml logs -f

# View logs for a single service
docker compose -f docker-compose.dev.yml logs -f api

# Stop services
docker compose -f docker-compose.dev.yml down

# Reset database (deletes all data)
docker compose -f docker-compose.dev.yml down -v

# Run migrations only (no seed)
docker compose -f docker-compose.dev.yml exec api python -m migrations.migrate

# Connect to the database
docker compose -f docker-compose.dev.yml exec db psql -U postgres -d ecomm
```
