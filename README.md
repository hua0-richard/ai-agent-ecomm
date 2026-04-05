# AI Agent for Steam

Amazon Rufus, but for Steam. A conversational AI assistant that helps gamers discover games from the Steam catalog using natural language, image search, and voice input.

## Features
- **Chat agent** — conversational game recommendations with session memory, streaming responses, and a relaxed gamer persona (always in English)
- **Text search** — hybrid BM25 + vector search with cross-encoder reranking
- **Image search** — upload a screenshot or artwork to find visually similar games (CLIP)
- **Voice input** — speak your query using Whisper transcription (local in dev, OpenAI API in prod)
- **Live Steam data** — agent can pull real-time prices, discounts, player counts, and game details from the Steam API
- **Chain-of-thought** — collapsible reasoning panel showing tool calls and agent steps in real time
- **Game screenshots** — product cards show header image and screenshot thumbnails from the Steam catalog
- **Deterministic card ordering** — product cards are reordered to match the order games appear in the agent's response

## Architecture

React frontend talks to a FastAPI backend that routes queries through a hybrid search pipeline (BM25 + pgvector), a TinyCLIP image embedding service, a Whisper speech-to-text service, and a LangChain chat agent backed by Ollama locally or OpenRouter in production.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "background": "#0b1020",
    "mainBkg": "#0b1020",
    "primaryTextColor": "#ffffff",
    "textColor": "#ffffff",
    "labelBackground": "rgba(0,0,0,0)",
    "edgeLabelBackground": "rgba(0,0,0,0)",
    "edgeLabelBorder": "rgba(0,0,0,0)",
    "edgeLabelBorderWidth": "0",
    "edgeLabelColor": "#ffffff",
    "lineColor": "#94a3b8",
    "clusterBkg": "#0b1020",
    "clusterBorder": "#334155",
    "clusterLabelColor": "#ffffff"
  }
} }%%

flowchart LR
    User(["User Browser<br/>(Client)"])

    subgraph Frontend["Frontend"]
        direction TB
        FE["React + Vite<br/>(Chat / Search / Voice UI)"]
    end

    subgraph Backend["Docker — Backend"]
        direction TB
        API["FastAPI<br/>(Chat, Search, Voice)"]
        CLIP["CLIP Service<br/>(TinyCLIP Embeddings)"]
        Whisper["Whisper<br/>(Speech-to-Text)"]
    end

    subgraph Data["Data"]
        direction TB
        DB[("PostgreSQL 16<br/>(pgvector)")]
    end

    subgraph LLMLayer["LLM"]
        direction TB
        Ollama["Ollama<br/>(Local Dev)"]
        OpenRouter["OpenRouter<br/>(Prod)"]
    end

    L_User_FE["HTTPS / User Actions"]
    L_FE_API["REST API / SSE Streaming"]
    L_API_DB["psycopg2<br/>BM25 + Vector Search"]
    L_API_CLIP["HTTP / Image Embedding"]
    L_API_Whisper["HTTP / Audio Transcription"]
    L_API_Ollama["LangChain / Tool Calling"]
    L_API_OR["LangChain / Tool Calling"]

    User --> L_User_FE --> FE
    FE --> L_FE_API --> API
    API --> L_API_DB --> DB
    API --> L_API_CLIP --> CLIP
    API --> L_API_Whisper --> Whisper
    API --> L_API_Ollama --> Ollama
    API --> L_API_OR --> OpenRouter

    classDef neutral fill:#111827,stroke:#334155,color:#ffffff;
    classDef react fill:#0d1f38,stroke:#61dafb,color:#ffffff;
    classDef fastapi fill:#002b1f,stroke:#00c896,color:#ffffff;
    classDef clip fill:#1a1a2e,stroke:#a78bfa,color:#ffffff;
    classDef whisper fill:#1a1a2e,stroke:#a78bfa,color:#ffffff;
    classDef pg fill:#0c2340,stroke:#336791,color:#ffffff;
    classDef ollama fill:#2b1b4b,stroke:#f97316,color:#ffffff;
    classDef openrouter fill:#2b1b4b,stroke:#a78bfa,color:#ffffff;
    classDef edgeText fill:transparent,stroke:transparent,color:#cbd5f5;

    class User neutral;
    class FE react;
    class API fastapi;
    class CLIP clip;
    class Whisper whisper;
    class DB pg;
    class Ollama ollama;
    class OpenRouter openrouter;
    class L_User_FE,L_FE_API,L_API_DB,L_API_CLIP,L_API_Whisper,L_API_Ollama,L_API_OR edgeText;

    style Frontend fill:#0a0a0a,stroke:#61dafb,color:#ffffff,stroke-width:1px
    style Backend fill:#001529,stroke:#00c896,color:#ffffff,stroke-width:1px
    style Data fill:#0f172a,stroke:#334155,color:#ffffff,stroke-width:1px
    style LLMLayer fill:#0f172a,stroke:#334155,color:#ffffff,stroke-width:1px

    linkStyle default stroke:#94a3b8,stroke-width:1.5px
```

| Service | Port | Description |
|---------|------|-------------|
| **fe** | 5173 | React + Vite + TypeScript frontend |
| **api** | 8000 | FastAPI backend (chat, search, voice) |
| **clip-service** | 8001 | TinyCLIP image/text embedding service |
| **whisper** | 9000 | Whisper ASR speech-to-text (tiny.en) |
| **db** | 5432 | PostgreSQL 16 + pgvector |

**Search pipeline:**
- Text queries use BM25 (keyword) + sentence-transformer vector search fused via RRF, then reranked by a cross-encoder to top 3
- Image queries use TinyCLIP to embed the uploaded image and search the `image_embedding` column via pgvector cosine distance
- The chat agent uses LangChain tool calling with session memory, streaming via SSE
- **Reliable Card Display:** The agent explicitly calls `show_product_cards` with `app_ids` to show game art. A fallback name-matching algorithm reorders cards to match the narrative order of the response.

**Agent tools:**
- `product_search_tool` — hybrid retrieval over the local catalog (always called before any recommendation)
- `show_product_cards` — explicitly displays game art and cards in the UI using app_ids (ensures 100% reliability)
- `steam_game_details_tool` — live price, player count, Metacritic, reviews, and platform info from Steam
- `steam_price_tool` — current price and active discounts
- `steam_player_count_tool` — live concurrent player count

**Models:**

| Role | Model | Dimensions | Provider |
|------|-------|------------|----------|
| LLM (dev) | `qwen2.5:7b` | — | Ollama (local, swap via `OLLAMA_MODEL`) |
| LLM (prod) | `anthropic/claude-3.5-haiku` | — | OpenRouter (swap via `OPENROUTER_MODEL`) |
| Text embeddings | `all-MiniLM-L6-v2` | 384 | sentence-transformers |
| Reranker | `cross-encoder/ms-marco-MiniLM-L-6-v2` | — | sentence-transformers |
| Image embeddings | `TinyCLIP-ViT-61M` | 512 | HuggingFace (CLIP service) |
| Voice (dev) | `tiny.en` | — | Whisper (local container) |
| Voice (prod) | `whisper-1` | — | OpenAI API |

## Request Flows

**Text chat:**
User message → LangChain agent calls `product_search_tool` → hybrid retrieval (BM25 0.4 + vector 0.6 weighted via RRF) → cross-encoder reranks top 10 → top 3 returned → LLM streams response via SSE → `_match_products_to_response()` validates and reorders cards by name match against response text → frontend renders cards + streamed text together.

**Image search:**
Upload → CLIP service embeds image (512-dim) → pgvector cosine distance search → top results formatted as context → LLM streams analysis via SSE → cards reordered to match LLM mention order → frontend renders uploaded image + matched cards + analysis.

**Voice input:**
Browser mic recording → POST audio to Whisper endpoint (local container in dev, OpenAI API in prod) → transcript populates text input → submitted as a normal chat query.

## Key Patterns

- **SSE streaming with token buffering** — tokens are buffered until `product_search_tool` completes, ensuring the UI doesn't start rendering text before product cards are ready
- **Context-Safe State Management** — uses Python's `contextvars` to isolate search results and UI state per request, ensuring that concurrent users never see each other's data even during high-volume streaming.
- **Deterministic card matching** — after the LLM finishes responding, `_match_products_to_response` finds each product name in the response text, reorders cards to match mention order, and appends unmentioned products as a fallback

- **Tool-first requirement** — the system prompt mandates `product_search_tool` is called before every recommendation; the UI shows no cards if skipped
- **Environment-driven switching** — `APP_ENV` controls LLM provider (Ollama vs OpenRouter), voice service (local Whisper vs OpenAI API), and database URL with no code branching
- **In-memory session history** — per-session chat history via `InMemoryChatMessageHistory`, scoped by `session_id` (not persistent across restarts)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Ollama](https://ollama.com) installed and running locally (dev)
- An [OpenRouter](https://openrouter.ai) API key (prod)

## Setup

1. **Clone the repo**

   ```bash
   git clone <repo-url>
   cd ai-agent-ecomm
   ```

2. **Pull the Ollama model** (dev only)

   ```bash
   ollama pull qwen2.5:7b
   # or for better quality at the cost of speed:
   ollama pull gemma3:27b
   ```

3. **Configure environment variables**

   ```bash
   cp be/.env.example be/.env
   ```

   For production, add your OpenRouter key to `be/.env`:

   ```
   OPENROUTER_API_KEY=sk-or-your-key-here
   ```

4. **Start all services**

   ```bash
   docker compose -f docker-compose.dev.yml up --build -d
   ```

   Wait for all health checks to pass. The clip-service takes ~60s on first start to download the model. Check status with:

   ```bash
   docker compose -f docker-compose.dev.yml ps
   ```

5. **Seed the database**

   ```bash
   docker compose -f docker-compose.dev.yml exec api python -m migrations.seed --limit 200
   ```

   This will:
   - Download the Steam games dataset from HuggingFace (cached to `/tmp/steam_games.parquet`)
   - Insert the top N games by estimated owners into the `games` table
   - Generate sentence embeddings using `all-MiniLM-L6-v2`
   - Download header images and generate CLIP embeddings via the clip-service
   - Insert everything into the `products` table

   Use `--limit N` to seed fewer games for faster startup. Omit for the full 5000.

6. **Open the app**

   Visit [http://localhost:5173](http://localhost:5173)

## Useful Commands

```bash
# Rebuild and restart a single service
docker compose -f docker-compose.dev.yml up -d --build api

# View logs
docker compose -f docker-compose.dev.yml logs -f api

# Re-seed after wiping products
docker compose -f docker-compose.dev.yml exec db psql -U postgres ecomm -c "TRUNCATE products;"
docker compose -f docker-compose.dev.yml exec api python -m migrations.seed --limit 200

# Check embedding coverage
docker compose -f docker-compose.dev.yml exec db psql -U postgres ecomm -c \
  "SELECT COUNT(*) total, COUNT(image_embedding) with_image, COUNT(text_embedding) with_text FROM products;"

# Connect to the database
docker compose -f docker-compose.dev.yml exec db psql -U postgres -d ecomm

# Stop services
docker compose -f docker-compose.dev.yml down

# Reset everything (deletes all data and volumes)
docker compose -f docker-compose.dev.yml down -v
```

## Future Improvements

- **Handling Partial Search Results** — Relax the agent's "always recommend 3" constraint to "up to 3" to improve reliability when the catalog contains fewer than 3 high-quality matches for a specific query.
- **Persistent Chat History** — Move from `InMemoryChatMessageHistory` to a database-backed history (e.g., PostgreSQL) to allow users to resume conversations after a backend restart.
- **Improved Name Matching (Fallback)** — Enhance the fallback regex matching in `_match_products_to_response` to better handle punctuation and word boundaries for cases where the explicit tool call is skipped.
