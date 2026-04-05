from typing import List
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

import tools.product_search as _product_search_module

class _ShowCardsInput(BaseModel):
    app_ids: List[int] = Field(description="The list of Steam app_ids for the games you are recommending and want to show as product cards in the UI.")

class ShowProductCardsTool(BaseTool):
    name: str = "show_product_cards"
    description: str = (
        "Call this tool to display game cards in the UI. "
        "Pass the app_ids of the games you have decided to recommend. "
        "You MUST call this tool whenever you want game art to appear for the user."
    )
    args_schema: type[BaseModel] = _ShowCardsInput

    def _run(self, app_ids: List[int]) -> str:
        # We don't actually 'do' anything here other than signal the intent.
        # The streaming handler in agent.py will intercept this tool call 
        # and emit the product data to the frontend.
        return f"UI will now show cards for these app_ids: {app_ids}"

    async def _arun(self, app_ids: List[int]) -> str:
        return self._run(app_ids)

show_product_cards_tool = ShowProductCardsTool()
