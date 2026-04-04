"""
Seed script: downloads the top 5000 most popular Steam games from HuggingFace,
stores raw data in `games`, then generates CLIP image embeddings and sentence
embeddings (name + description) and inserts into `products`.

Usage (run from the `be` container or with DATABASE_URL + CLIP_SERVICE_URL set):
    python -m migrations.seed
"""

import json
import os
import time

import httpx
import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/ecomm")
CLIP_SERVICE_URL = os.getenv("CLIP_SERVICE_URL", "http://clip-service:8001")
DATASET_URL = "hf://datasets/FronkonGames/steam-games-dataset/data/train-00000-of-00001.parquet"
TOP_N = 5000
TEXT_MODEL_NAME = "all-MiniLM-L6-v2"
CLIP_BATCH_PAUSE = 0.05          # small pause between CLIP requests to avoid overwhelming the service
IMAGE_DOWNLOAD_TIMEOUT = 10.0

# Columns to keep from the raw dataset
RAW_COLUMNS = [
    "AppID", "Name", "Release date", "Estimated owners", "Peak CCU",
    "Price", "Short description", "Detailed description", "Header image",
    "Website", "Developers", "Publishers", "Categories", "Genres", "Tags",
    "Screenshots", "Metacritic score", "Positive", "Negative",
    "Recommendations", "Average playtime forever", "Windows", "Mac", "Linux",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def parse_owner_lower_bound(owners_str: str) -> int:
    """Parse '10,000,000 - 20,000,000' → 10000000."""
    try:
        low = owners_str.split("-")[0].strip().replace(",", "")
        return int(low)
    except Exception:
        return 0


def safe_json(val) -> str | None:
    """Convert list/dict columns to JSON strings for storage."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, (list, dict)):
        return json.dumps(val)
    return str(val)


def get_db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def download_image(url: str) -> bytes | None:
    try:
        with httpx.Client(timeout=IMAGE_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.content
    except Exception:
        return None


def clip_image_embedding(image_bytes: bytes) -> list[float] | None:
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{CLIP_SERVICE_URL}/embedding/image",
                files={"file": ("image.jpg", image_bytes, "image/jpeg")},
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
    except Exception as e:
        print(f"  CLIP error: {e}")
        return None


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------
def load_dataset() -> pd.DataFrame:
    print("Downloading dataset from HuggingFace...")
    df = pd.read_parquet(DATASET_URL)
    print(f"  Total rows: {len(df)}")

    # Parse popularity and sort
    df["_owner_lb"] = df["Estimated owners"].apply(parse_owner_lower_bound)
    df = df.sort_values("_owner_lb", ascending=False).head(TOP_N).reset_index(drop=True)
    print(f"  Kept top {len(df)} by estimated owners")

    # Filter to only rows with a name and header image
    df = df[df["Name"].notna() & (df["Name"].str.strip() != "")]
    df = df[df["Header image"].notna() & (df["Header image"].str.strip() != "")]
    df = df.reset_index(drop=True)
    print(f"  After filtering empty names/images: {len(df)}")
    return df


def create_tables(conn):
    print("Creating tables...")
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                app_id INTEGER UNIQUE NOT NULL,
                name TEXT NOT NULL,
                release_date TEXT,
                estimated_owners TEXT,
                peak_ccu INTEGER DEFAULT 0,
                price NUMERIC(10, 2) DEFAULT 0,
                short_description TEXT,
                detailed_description TEXT,
                header_image TEXT,
                website TEXT,
                developers TEXT,
                publishers TEXT,
                categories TEXT,
                genres TEXT,
                tags TEXT,
                screenshots TEXT,
                metacritic_score INTEGER DEFAULT 0,
                positive INTEGER DEFAULT 0,
                negative INTEGER DEFAULT 0,
                recommendations INTEGER DEFAULT 0,
                average_playtime_forever INTEGER DEFAULT 0,
                windows BOOLEAN DEFAULT FALSE,
                mac BOOLEAN DEFAULT FALSE,
                linux BOOLEAN DEFAULT FALSE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id),
                name TEXT NOT NULL,
                description TEXT,
                price NUMERIC(10, 2) NOT NULL,
                image_url TEXT,
                image_embedding vector(512),
                text_embedding vector(384)
            )
        """)
    conn.commit()


def insert_raw_games(conn, df: pd.DataFrame) -> dict[int, int]:
    """Insert raw game data. Returns {app_id: games.id} mapping."""
    print("Inserting raw games...")
    rows = []
    for _, r in df.iterrows():
        rows.append((
            int(r["AppID"]),
            r["Name"],
            r.get("Release date"),
            r.get("Estimated owners"),
            int(r.get("Peak CCU") or 0),
            float(r.get("Price") or 0),
            r.get("Short description"),
            r.get("Detailed description"),
            r.get("Header image"),
            r.get("Website") if pd.notna(r.get("Website")) else None,
            safe_json(r.get("Developers")),
            safe_json(r.get("Publishers")),
            safe_json(r.get("Categories")),
            safe_json(r.get("Genres")),
            safe_json(r.get("Tags")),
            safe_json(r.get("Screenshots")),
            int(r.get("Metacritic score") or 0),
            int(r.get("Positive") or 0),
            int(r.get("Negative") or 0),
            int(r.get("Recommendations") or 0),
            int(r.get("Average playtime forever") or 0),
            bool(r.get("Windows")),
            bool(r.get("Mac")),
            bool(r.get("Linux")),
        ))

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO games (
                app_id, name, release_date, estimated_owners, peak_ccu,
                price, short_description, detailed_description, header_image,
                website, developers, publishers, categories, genres, tags,
                screenshots, metacritic_score, positive, negative,
                recommendations, average_playtime_forever,
                windows, mac, linux
            ) VALUES %s
            ON CONFLICT (app_id) DO NOTHING
            """,
            rows,
        )
    conn.commit()

    # Build app_id → games.id mapping
    with conn.cursor() as cur:
        cur.execute("SELECT id, app_id FROM games")
        return {row["app_id"]: row["id"] for row in cur.fetchall()}


def generate_text_embeddings(df: pd.DataFrame) -> list[list[float]]:
    """Generate sentence embeddings for name + short description."""
    print(f"Loading sentence-transformer model ({TEXT_MODEL_NAME})...")
    model = SentenceTransformer(TEXT_MODEL_NAME)

    texts = []
    for _, r in df.iterrows():
        name = r["Name"] or ""
        desc = r.get("Short description") or ""
        texts.append(f"{name}. {desc}".strip())

    print(f"Encoding {len(texts)} text entries...")
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=128)
    return [emb.tolist() for emb in embeddings]


def generate_image_embeddings_and_insert(conn, df: pd.DataFrame, app_id_map: dict, text_embeddings: list):
    """Download images, get CLIP embeddings, and insert products."""
    print("Generating CLIP image embeddings and inserting products...")
    total = len(df)
    inserted = 0
    skipped = 0

    for idx, (_, r) in enumerate(df.iterrows()):
        app_id = int(r["AppID"])
        game_id = app_id_map.get(app_id)
        if game_id is None:
            skipped += 1
            continue

        name = r["Name"]
        desc = r.get("Short description") or ""
        price = float(r.get("Price") or 0)
        image_url = r.get("Header image")
        text_emb = text_embeddings[idx]

        # Download image and get CLIP embedding
        image_emb = None
        if image_url and pd.notna(image_url):
            image_bytes = download_image(image_url)
            if image_bytes:
                image_emb = clip_image_embedding(image_bytes)
                time.sleep(CLIP_BATCH_PAUSE)

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO products (game_id, name, description, price, image_url, image_embedding, text_embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (game_id, name, desc, price, image_url, image_emb, text_emb),
            )
        conn.commit()
        inserted += 1

        if (idx + 1) % 100 == 0:
            print(f"  [{idx + 1}/{total}] inserted={inserted} skipped={skipped}")

    print(f"Done: {inserted} products inserted, {skipped} skipped")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    df = load_dataset()

    conn = get_db()
    try:
        create_tables(conn)
        app_id_map = insert_raw_games(conn, df)
        text_embeddings = generate_text_embeddings(df)
        generate_image_embeddings_and_insert(conn, df, app_id_map, text_embeddings)
    finally:
        conn.close()

    print("Seed complete!")


if __name__ == "__main__":
    main()
