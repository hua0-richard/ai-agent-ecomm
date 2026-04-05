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


def _parse_price(app_id: int, data: dict) -> str:
    entry = data.get(str(app_id), {})
    if not entry.get("success"):
        return f"No price data found for app_id {app_id}."
    price_data = entry.get("data", {}).get("price_overview")
    if not price_data:
        return "This game is free to play (no price listed)."
    final = price_data["final"] / 100
    initial = price_data["initial"] / 100
    discount = price_data.get("discount_percent", 0)
    currency = price_data.get("currency", "USD")
    if discount > 0:
        return f"Current price: {currency} ${final:.2f} ({discount}% off from ${initial:.2f})"
    return f"Current price: {currency} ${final:.2f}"


def _parse_player_count(app_id: int, data: dict) -> str | None:
    count = data.get("response", {}).get("player_count")
    if count is None:
        return None
    return f"Current players online: {count:,}"


def _parse_game_details(app_id: int, store_data: dict, player_data: dict | None) -> str:
    lines: list[str] = []
    entry = store_data.get(str(app_id), {})
    if entry.get("success") and entry.get("data"):
        d = entry["data"]
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

    if player_data:
        count_str = _parse_player_count(app_id, player_data)
        if count_str:
            lines.append(count_str)

    return "\n".join(lines) if lines else f"No data found for app_id {app_id}."


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
            return _parse_price(app_id, resp.json())
        except Exception as e:
            return f"Failed to fetch price: {e}"

    async def _arun(self, app_id: int) -> str:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(
                    _STORE_API,
                    params={"appids": app_id, "filters": "price_overview", "cc": "us", "l": "english"},
                )
                resp.raise_for_status()
                return _parse_price(app_id, resp.json())
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
            resp = httpx.get(_STATS_API, params={"appid": app_id}, timeout=8)
            resp.raise_for_status()
            return _parse_player_count(app_id, resp.json()) or f"Could not retrieve player count for app_id {app_id}."
        except Exception as e:
            return f"Failed to fetch player count: {e}"

    async def _arun(self, app_id: int) -> str:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(_STATS_API, params={"appid": app_id})
                resp.raise_for_status()
                return _parse_player_count(app_id, resp.json()) or f"Could not retrieve player count for app_id {app_id}."
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
        store_data = {}
        player_data = None
        try:
            resp = httpx.get(
                _STORE_API,
                params={"appids": app_id, "cc": "us", "l": "english"},
                timeout=8,
            )
            resp.raise_for_status()
            store_data = resp.json()
        except Exception as e:
            return f"Store data unavailable: {e}"
        try:
            resp = httpx.get(_STATS_API, params={"appid": app_id}, timeout=8)
            resp.raise_for_status()
            player_data = resp.json()
        except Exception:
            pass
        return _parse_game_details(app_id, store_data, player_data)

    async def _arun(self, app_id: int) -> str:
        store_data = {}
        player_data = None
        async with httpx.AsyncClient(timeout=8) as client:
            try:
                resp = await client.get(
                    _STORE_API,
                    params={"appids": app_id, "cc": "us", "l": "english"},
                )
                resp.raise_for_status()
                store_data = resp.json()
            except Exception as e:
                return f"Store data unavailable: {e}"
            try:
                resp = await client.get(_STATS_API, params={"appid": app_id})
                resp.raise_for_status()
                player_data = resp.json()
            except Exception:
                pass
        return _parse_game_details(app_id, store_data, player_data)


steam_price_tool = SteamPriceTool()
steam_player_count_tool = SteamPlayerCountTool()
steam_game_details_tool = SteamGameDetailsTool()
