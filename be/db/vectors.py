from db.connection import get_cursor

EMBEDDING_DIM = 512  # CLIP ViT-B/32 output dimension


def init_vector_store():
    """Create the products table with pgvector column if it doesn't exist."""
    with get_cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price NUMERIC(10, 2) NOT NULL,
                image_url TEXT,
                embedding vector({EMBEDDING_DIM})
            )
        """)


async def similarity_search(embedding: list[float], limit: int = 10) -> list[dict]:
    return similarity_search_sync(embedding, limit)


def similarity_search_sync(embedding: list[float], limit: int = 10) -> list[dict]:
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT id, name, description, price, image_url,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM products
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (embedding, embedding, limit),
        )
        return [dict(row) for row in cur.fetchall()]
