from db.connection import get_cursor

IMAGE_EMBEDDING_DIM = 512   # TinyCLIP-ViT-61M output dimension
TEXT_EMBEDDING_DIM = 384     # all-MiniLM-L6-v2 output dimension


def init_tables():
    """Create the games (raw) and products (vector search) tables."""
    with get_cursor() as cur:
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

        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id),
                name TEXT NOT NULL,
                description TEXT,
                price NUMERIC(10, 2) NOT NULL,
                image_url TEXT,
                image_embedding vector({IMAGE_EMBEDDING_DIM}),
                text_embedding vector({TEXT_EMBEDDING_DIM})
            )
        """)


async def similarity_search(embedding: list[float], limit: int = 10) -> list[dict]:
    return similarity_search_sync(embedding, limit)


async def similarity_search_text(embedding: list[float], limit: int = 10) -> list[dict]:
    return text_similarity_search(embedding, limit)


def similarity_search_sync(embedding: list[float], limit: int = 10) -> list[dict]:
    """Search products by image embedding (CLIP cross-modal)."""
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT p.id, p.name, p.description, p.price, p.image_url,
                   g.screenshots,
                   1 - (p.image_embedding <=> %s::vector) AS similarity
            FROM products p
            JOIN games g ON g.id = p.game_id
            WHERE p.image_embedding IS NOT NULL
            ORDER BY p.image_embedding <=> %s::vector
            LIMIT %s
            """,
            (embedding, embedding, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def get_all_products() -> list[dict]:
    with get_cursor() as cur:
        cur.execute("""
            SELECT p.id, p.name, p.description, p.price, p.image_url, g.screenshots
            FROM products p
            JOIN games g ON g.id = p.game_id
        """)
        return [dict(row) for row in cur.fetchall()]


def text_similarity_search(embedding: list[float], limit: int = 10) -> list[dict]:
    """Search products by text embedding (sentence-transformer)."""
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT p.id, p.name, p.description, p.price, p.image_url,
                   g.screenshots,
                   1 - (p.text_embedding <=> %s::vector) AS similarity
            FROM products p
            JOIN games g ON g.id = p.game_id
            WHERE p.text_embedding IS NOT NULL
            ORDER BY p.text_embedding <=> %s::vector
            LIMIT %s
            """,
            (embedding, embedding, limit),
        )
        return [dict(row) for row in cur.fetchall()]
