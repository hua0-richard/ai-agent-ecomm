from contextvars import ContextVar
from langchain_core.tools import BaseTool
from pydantic import BaseModel, field_validator

from retrievers.hybrid import build_hybrid_retriever
from tools.internet_search import tavily_search_tool

# Context-local store for the most recent product search results.
# This is safe for concurrent requests.
search_results_var: ContextVar[list[dict]] = ContextVar("search_results", default=[])


class _Input(BaseModel):
    query: str

    @field_validator("query", mode="before")
    @classmethod
    def coerce_query(cls, v: object) -> str:
        if isinstance(v, dict):
            return str(v.get("value") or v.get("query") or next(iter(v.values()), ""))
        return str(v)


_NO_MATCH = "No matching games found."

_FALLBACK_PREAMBLE = (
    "No matching games found in the Steam catalog. These results come from a web search "
    "instead, so they are NOT catalog entries and have no app_id. Do not call "
    "show_product_cards for them. Tell the user the game is not in the catalog, then "
    "summarise what is relevant below.\n\nWeb results:\n"
)


def _format_web_results(raw: object) -> str:
    """Tavily returns a list of {title, url, content} dicts, or a plain string."""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, list):
        lines = []
        for item in raw:
            if isinstance(item, dict):
                title = item.get("title") or item.get("url") or ""
                content = (item.get("content") or "").strip()
                lines.append(f"- {title}: {content}" if title else f"- {content}")
            else:
                lines.append(f"- {item}")
        return "\n".join(line for line in lines if line.strip(" -"))
    return ""


def _web_fallback(query: str) -> str:
    """Search the web when the catalog has nothing, degrading to the plain
    'not found' message if Tavily is unconfigured or erroring."""
    try:
        raw = tavily_search_tool.invoke({"query": f"{query} Steam game"})
    except Exception:
        return _NO_MATCH

    # The stub tool returns a plain sentence when TAVILY_API_KEY is unset
    if isinstance(raw, str) and "disabled" in raw.lower():
        return _NO_MATCH

    results = _format_web_results(raw)
    if not results:
        return _NO_MATCH
    return _FALLBACK_PREAMBLE + results


class ProductSearchTool(BaseTool):
    name: str = "product_search_tool"
    description: str = (
        "Search the Steam game catalog by description, genre, mood, or gameplay style. "
        "Returns the most relevant games ranked by relevance, including each game's app_id "
        "which is required by the Steam live data tools."
    )
    args_schema: type[BaseModel] = _Input

    def _run(self, query: str) -> str:
        return self._search(query)

    async def _arun(self, query: str) -> str:
        return self._search(query)

    def _search(self, query: str) -> str:
        retriever = build_hybrid_retriever()
        docs = retriever.invoke(query)
        
        # Get the mutable container from the context
        container = search_results_var.get()
        container.clear() # Reset for this search
        
        if not docs:
            # Fall back to the web here rather than leaving it to the model. A small
            # model frequently fails to notice the empty result and chain the call
            # itself, and doing it inline also saves an agent iteration.
            return _web_fallback(query)

        results = [doc.metadata for doc in docs]
        container.extend(results) # Mutate the list so the parent sees it
        
        return "\n".join(
            f"[{i+1}] {d['name']} (app_id={d.get('app_id', 'unknown')}, ${d['price']:.2f}): {d.get('description', '')}"
            for i, d in enumerate(results)
        )


product_search_tool = ProductSearchTool()
