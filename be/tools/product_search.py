from contextvars import ContextVar

from langchain_core.tools import BaseTool
from pydantic import BaseModel, field_validator

from retrievers.hybrid import build_hybrid_retriever

# Per-request storage for product results. Each async request gets its own copy,
# so concurrent users never overwrite each other's results.
request_products: ContextVar[list[dict]] = ContextVar("request_products", default=[])


class _Input(BaseModel):
    query: str

    @field_validator("query", mode="before")
    @classmethod
    def coerce_query(cls, v: object) -> str:
        if isinstance(v, dict):
            return str(v.get("value") or v.get("query") or next(iter(v.values()), ""))
        return str(v)


class ProductSearchTool(BaseTool):
    name: str = "product_search_tool"
    description: str = (
        "Search the Steam game catalog by description, genre, mood, or gameplay style. "
        "Returns the most relevant games ranked by relevance, including each game's app_id "
        "which is required by the Steam live data tools."
    )
    args_schema: type[BaseModel] = _Input

    def _run(self, query: str) -> str:
        retriever = build_hybrid_retriever()
        docs = retriever.invoke(query)
        if not docs:
            request_products.set([])
            return "No matching games found."

        products = [doc.metadata for doc in docs]
        request_products.set(products)
        return "\n".join(
            f"[{i+1}] {d['name']} (app_id={d.get('app_id', 'unknown')}, ${d['price']:.2f}): {d.get('description', '')}"
            for i, d in enumerate(products)
        )


product_search_tool = ProductSearchTool()
