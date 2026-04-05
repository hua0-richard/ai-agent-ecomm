import os
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

def get_tavily_tool() -> BaseTool:
    """Returns a Tavily search tool if the API key is present."""
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        # Return a dummy tool or a descriptive error if called without a key
        class NoTavilyTool(BaseTool):
            name: str = "tavily_search_tool"
            description: str = "Search the internet for general information. (Disabled: Missing TAVILY_API_KEY)"
            def _run(self, query: str) -> str:
                return "Tavily search is currently disabled because the TAVILY_API_KEY is not set in the environment."
        return NoTavilyTool()
        
    return TavilySearchResults(
        max_results=3,
        description=(
            "A search engine optimized for comprehensive, accurate, and trusted results. "
            "Use this ONLY when product_search_tool returns no results for a specific game name, "
            "or when a user asks for very recent gaming news or release dates that might not be in the database."
        )
    )

tavily_search_tool = get_tavily_tool()
