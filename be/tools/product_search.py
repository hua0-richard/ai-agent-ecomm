from langchain_core.tools import tool

from retrievers.hybrid import build_hybrid_retriever


@tool
def product_search_tool(query: str) -> str:
    """Search the Steam game catalog by description, genre, mood, or gameplay style. Returns the most relevant games ranked by relevance."""
    retriever = build_hybrid_retriever()
    docs = retriever.invoke(query)
    if not docs:
        return "No matching products found."
    return "\n".join(
        f"- {d.metadata['name']} (${d.metadata['price']:.2f}): {d.metadata.get('description', '')}"
        for d in docs
    )
