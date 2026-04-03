from langchain_core.tools import tool

from embeddings.clip import get_text_embedding
from db.vectors import similarity_search_sync


@tool
def product_search_tool(query: str) -> str:
    """Search for products by text description. Returns matching products ranked by relevance."""
    embedding = get_text_embedding(query)
    results = similarity_search_sync(embedding)
    if not results:
        return "No matching products found."
    return "\n".join(
        f"- {r['name']} (${r['price']:.2f}): {r['description']}"
        for r in results
    )
