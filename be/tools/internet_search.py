import os
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

def get_tavily_tool() -> BaseTool:
    """Returns a Tavily search tool if the API key is present."""
    api_key = os.getenv("TAVILY_API_KEY")
    
    description = (
        "A search engine optimized for comprehensive, accurate, and trusted results. "
        "Use this as a fallback if product_search_tool returns no results for a specific game name, "
        "or when a user asks for very recent gaming news or release dates that might not be in the database."
    )

    if not api_key:
        # Return a tool that says it's missing the key ONLY when called.
        # This prevents the LLM from seeing "(Disabled)" in its tool list.
        class TavilySearchTool(BaseTool):
            name: str = "tavily_search_tool"
            description: str = description
            def _run(self, query: str) -> str:
                return "Tavily search is currently disabled because the TAVILY_API_KEY is not set in the environment. Please add it to the .env file."
        return TavilySearchTool()
        
    # If key is present, use the real tool but ensure the name is what the agent expects
    real_tool = TavilySearchResults(max_results=3)
    real_tool.name = "tavily_search_tool"
    real_tool.description = description
    return real_tool

tavily_search_tool = get_tavily_tool()
