import httpx
from langchain_core.tools import BaseTool
from pydantic import BaseModel, field_validator

_STORE_API = "https://store.steampowered.com/api/appdetails"
_STATS_API = "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/"


class _AppIdInput(BaseModel):
    app_id: int

    @field_validator("app_id", mode="before")
    @classmethod
    def coerce_app_id(cls, v: object) -> int:
        if isinstance(v, dict):
            v = v.get("value") or v.get("app_id") or next(iter(v.values()), 0)
        return int(v)


class SteamPriceTool(BaseTool):
    name: str = "steam_price_tool"
    description: str = (
        "Get the current Steam store price for a game given its Steam app_id. "
        "Use product_search_tool first to find the app_id, then call this tool "
        "for the live price (including any active discounts). "
        "Returns price in USD and any active sale percentage."
    )
    args_schema: type[BaseModel] = _AppIdInput

    def _run(self, app_id: int) -> str:
        try:
            resp = httpx.get(
                _STORE_API,
                params={"appids": app_id, "filters": "price_overview", "cc": "us", "l": "english"},
                timeout=8,
            )
            resp.raise_for_status()
            data = resp.json().get(str(app_id), {})
            if not data.get("success"):
                return f"No price data found for app_id {app_id}."
            price_data = data.get("data", {}).get("price_overview")
            if not price_data:
                return "This game is free to play (no price listed)."
            final = price_data["final"] / 100
            initial = price_data["initial"] / 100
            discount = price_data.get("discount_percent", 0)
            currency = price_data.get("currency", "USD")
            if discount > 0:
                return (
                    f"Current price: {currency} ${final:.2f} "
                    f"({discount}% off from ${initial:.2f})"
                )
            return f"Current price: {currency} ${final:.2f}"
        except Exception as e:
            return f"Failed to fetch price: {e}"


class SteamPlayerCountTool(BaseTool):
    name: str = "steam_player_count_tool"
    description: str = (
        "Get the current number of players online in a Steam game given its app_id. "
        "Use product_search_tool first to find the app_id, then call this tool "
        "to check live player counts. Useful for gauging how active a game's community is."
    )
    args_schema: type[BaseModel] = _AppIdInput

    def _run(self, app_id: int) -> str:
        try:
            resp = httpx.get(
                _STATS_API,
                params={"appid": app_id},
                timeout=8,
            )
            resp.raise_for_status()
            result = resp.json().get("response", {})
            count = result.get("player_count")
            if count is None:
                return f"Could not retrieve player count for app_id {app_id}."
            return f"Current players online: {count:,}"
        except Exception as e:
            return f"Failed to fetch player count: {e}"


class SteamGameDetailsTool(BaseTool):
    name: str = "steam_game_details_tool"
    description: str = (
        "Get comprehensive live details for a Steam game by its app_id: "
        "current price (with discounts), live player count, review summary, "
        "Metacritic score, and supported platforms. "
        "Use product_search_tool first to find the app_id, then call this for a full snapshot."
    )
    args_schema: type[BaseModel] = _AppIdInput

    def _run(self, app_id: int) -> str:
        lines: list[str] = []
        try:
            store_resp = httpx.get(
                _STORE_API,
                params={"appids": app_id, "cc": "us", "l": "english"},
                timeout=8,
            )
            store_resp.raise_for_status()
            store_data = store_resp.json().get(str(app_id), {})
            if store_data.get("success") and store_data.get("data"):
                d = store_data["data"]
                price_overview = d.get("price_overview")
                if price_overview:
                    final = price_overview["final"] / 100
                    discount = price_overview.get("discount_percent", 0)
                    initial = price_overview["initial"] / 100
                    if discount > 0:
                        lines.append(f"Price: ${final:.2f} ({discount}% off from ${initial:.2f})")
                    else:
                        lines.append(f"Price: ${final:.2f}")
                else:
                    lines.append("Price: Free to Play")

                metacritic = d.get("metacritic", {})
                if metacritic.get("score"):
                    lines.append(f"Metacritic: {metacritic['score']}/100")

                platforms = d.get("platforms", {})
                supported = [p for p, ok in platforms.items() if ok]
                if supported:
                    lines.append(f"Platforms: {', '.join(supported)}")

                categories = [c["description"] for c in d.get("categories", [])]
                if categories:
                    lines.append(f"Features: {', '.join(categories[:5])}")
        except Exception as e:
            lines.append(f"Store data unavailable: {e}")

        try:
            player_resp = httpx.get(_STATS_API, params={"appid": app_id}, timeout=8)
            player_resp.raise_for_status()
            count = player_resp.json().get("response", {}).get("player_count")
            if count is not None:
                lines.append(f"Current players online: {count:,}")
        except Exception:
            pass

        return "\n".join(lines) if lines else f"No data found for app_id {app_id}."


steam_price_tool = SteamPriceTool()
steam_player_count_tool = SteamPlayerCountTool()
steam_game_details_tool = SteamGameDetailsTool()
