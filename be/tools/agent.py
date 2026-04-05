import os

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

import tools.product_search as _product_search_module
from tools.product_search import product_search_tool
from tools.ui import show_product_cards_tool
from tools.steam_live import steam_price_tool, steam_player_count_tool, steam_game_details_tool

_sessions: dict[str, InMemoryChatMessageHistory] = {}

# Max number of recent messages (user + assistant pairs) to include in context.
# Keeps the LLM focused on the current query and avoids old game names bleeding
# into new recommendations.
MAX_HISTORY_MESSAGES = 4


def _get_history(session_id: str | None) -> InMemoryChatMessageHistory:
    if not session_id:
        return InMemoryChatMessageHistory()
    if session_id not in _sessions:
        _sessions[session_id] = InMemoryChatMessageHistory()
    return _sessions[session_id]


SYSTEM_PROMPT = """You are a helpful Steam shopping assistant — think Amazon Rufus, but for games. \
You help people find the right game for them from the Steam catalog. \
You're friendly, concise, and focused on matching users to games they'll actually enjoy. \
Always respond in English regardless of the language the user writes in.

STRICT RULE:
You MUST call product_search_tool before every recommendation, every single time — even if you already know the game, \
even on follow-up turns, even if the user names the game directly. \
If you skip this call, the UI will show no game cards and your entire response becomes useless to the user. \
The ONLY exception is when the user says a visual similarity search has already been done and provides a list of matched games (including their names and app_ids). \
In that case, DO NOT call product_search_tool — the search is already done, and the results are provided. Just discuss the games provided using their exact names. You can still use other tools (like price or player count) using the app_ids provided in the list.

UI RULE:
You MUST call show_product_cards with the list of app_ids for the games you are recommending. \
This is the ONLY way the user will see the game art and prices. Call this tool immediately after you decide which games to recommend.

PERSONA:
- You're a knowledgeable shopping assistant, not a gamer friend. Stay helpful and product-focused.
- Be warm and conversational but keep the focus on helping the user find what they want.
- Proactively mention the game cards you're showing (e.g., "I've pulled up the cards for these games below").
- Highlight what makes each game a good fit for what the user asked — genre, features, reviews, price.
- If a game has notable drawbacks relevant to the user's request, mention them briefly.
- Keep responses concise. A few sentences per game is enough — don't write essays.
- Match the user's energy. Short question → short answer. Detailed question → more detail.
- Never re-introduce yourself or your capabilities mid-conversation.
- Use Markdown formatting (like **bolding** game names or using bulleted lists) to make your response structured and easy to read.
- **VISUAL STYLE:**
    - Use emojis to make the response more engaging (e.g., 🏷️ for sales, 🔥 for popularity, 🎮 for gameplay).
    - Make key stats (price, discounts, player counts) pop by using bolding or specific formatting like `[Stat: Value]`.
    - Use bullet points for recommendations to keep them distinct.

TOOLS:
- product_search_tool: find games by genre, vibe, gameplay style, or name. \
  Returns app_ids needed by the Steam tools — never show app_ids to the user.
- show_product_cards: display the official game cards (art, price, etc.) in the UI for the user. \
  Call this with the app_ids of your final recommendations.
- steam_game_details_tool: live price, player count, Metacritic, reviews, platforms. \
  Use when the user wants the full picture on a specific game.
- steam_price_tool: current price/discounts only. Use when cost is the specific question.
- steam_player_count_tool: live concurrent players. Use when community size is the question.

CONVERSATION RULES:
- Never show app_ids or raw tool output to the user — translate it into natural language.
- Never narrate what you're doing — no "let me look that up", "searching now", or any \
  commentary about tool use. Just respond with the result directly.
- Always recommend exactly 3 games from the search results. Lead with your top pick, then briefly cover the other two.
- NEVER recommend a game that was not returned by product_search_tool or the visual similarity search.
- NEVER ask clarifying questions — always commit to a recommendation. \
  You can mention what you assumed ("I went with story-driven since you didn't specify"), but always lead with actual games.
- If the user is vague or says "surprise me" — pick something good and go with it.
- ALWAYS use the EXACT game name as returned by product_search_tool — do not shorten, abbreviate, or rephrase game titles. \
  The UI matches your text to product cards by name, so even small differences (like missing a colon or subtitle) will break the match and hide the game art.
- Honor ALL constraints the user has set in the conversation. If they said "indie", every recommendation must be indie. \
  If they said "no shooters", never suggest a shooter. Treat these as hard filters that persist for the whole session.

FEW-SHOT EXAMPLES:

User: "What are some popular horror games that are on sale right now?"
Action: 
1. Call product_search_tool(query="popular horror games")
2. Call steam_game_details_tool for each of the top 3 results to check prices and player counts.
3. Call show_product_cards with the app_ids of the 3 games.
Response: "I've found some top-tier horror titles with great deals for you! 🧟

- **Resident Evil Village**: 🏷️ **60% OFF** — Now only **$15.99**! A masterclass in atmosphere and tension.
- **Dead by Daylight**: 🔥 **45,000+ players** online right now. It's the ultimate hide-and-seek horror experience.
- **Phasmophobia**: 🏷️ **20% OFF** — Great for co-op ghost hunting with friends!

I've pulled up the cards for these games below so you can check out the trailers! 🎮"

User: "Find the most popular games on Steam right now."
Action:
1. Call product_search_tool(query="top sellers most played games")
2. Call steam_player_count_tool for the top 3 results to get live data.
3. Call show_product_cards with the app_ids.
Response: "The Steam charts are absolutely on fire right now! 🔥 Here are the heavy hitters:

- **Counter-Strike 2**: 👑 **1,240,000+ players** online. The undisputed king of tactical shooters.
- **Dota 2**: ⚔️ **650,000+ players** battling it out right now.
- **PUBG: BATTLEGROUNDS**: 🪂 **480,000+ players** in-game.

These are the most active communities on the platform today! 🎮"

User: "How many people are playing Elden Ring, Baldur's Gate 3, and Cyberpunk 2077 right now?"
Action:
1. Call product_search_tool(query="Elden Ring, Baldur's Gate 3, Cyberpunk 2077")
2. Call steam_player_count_tool for each of the 3 app_ids returned.
3. Call show_product_cards with the app_ids.
Response: "I've pulled the live data for those three blockbusters! 🎮

- **ELDEN RING**: 🗡️ **85,000+ players** exploring the Lands Between.
- **Baldur's Gate 3**: 🎲 **120,000+ players** on their epic adventure.
- **Cyberpunk 2077**: 🦾 **45,000+ players** roaming Night City.

It looks like **Baldur's Gate 3** is the most active of the bunch right now! 🔥"
"""

_tools = [product_search_tool, show_product_cards_tool, steam_game_details_tool, steam_price_tool, steam_player_count_tool]

_prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    MessagesPlaceholder("chat_history", optional=True),
    ("human", "{input}"),
    MessagesPlaceholder("agent_scratchpad"),
])

if os.getenv("APP_ENV") == "development":
    llm = ChatOpenAI(
        model=os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
        base_url=f"{os.getenv('OLLAMA_URL', 'http://host.docker.internal:11434')}/v1",
        api_key="ollama",
    )
else:
    llm = ChatOpenAI(
        model=os.getenv("OPENROUTER_MODEL", "anthropic/claude-3.5-haiku"),
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY"),
    )

_executor = AgentExecutor(
    agent=create_tool_calling_agent(llm, _tools, _prompt),
    tools=_tools,
    verbose=True,
    max_iterations=5,
    max_execution_time=60,
    handle_parsing_errors=True,
)


def _match_products_to_response(products: list[dict], response: str) -> list[dict]:
    """Match product cards to the LLM response by name, returning only confirmed matches
    in the order they appear in the text. Products the LLM didn't mention are dropped —
    showing an unrelated card is worse than showing fewer cards.

    Matches longer names first so that e.g. "Resident Evil Village" is consumed before
    "Resident Evil" can falsely match the same text region."""
    if not products or not response:
        return products
    response_lower = response.lower()

    # Sort products by name length descending so longer names match first
    candidates = sorted(products, key=lambda p: len(p.get("name") or ""), reverse=True)

    mentioned: list[tuple[int, dict]] = []
    # Track which character ranges have been claimed by a match
    claimed: set[int] = set()

    for p in candidates:
        name = (p.get("name") or "").lower()
        if not name:
            continue
        # Search for the name, skipping regions already claimed by a longer name
        start = 0
        while start <= len(response_lower) - len(name):
            pos = response_lower.find(name, start)
            if pos < 0:
                break
            match_range = range(pos, pos + len(name))
            if not any(i in claimed for i in match_range):
                mentioned.append((pos, p))
                claimed.update(match_range)
                break
            start = pos + 1

    # Sort by position in the response so cards match the LLM's narrative order
    mentioned.sort(key=lambda x: x[0])
    return [p for _, p in mentioned]


async def stream_agent_response(
    message: str, 
    session_id: str | None = None, 
    history_override: str | None = None,
    initial_products: list[dict] | None = None
):
    # Initialize the mutable container in this context. 
    # Tools will mutate this list to communicate results back.
    container = list(initial_products) if initial_products else []
    _product_search_module.search_results_var.set(container)
    history = _get_history(session_id)
    full_response = ""
    product_search_called = False
    token_buffer: list[dict] = []
    # If we have initial products (from image search), treat them as pending
    pending_products: list[dict] = list(container)
    explicit_ui_products: list[dict] = []

    async for event in _executor.astream_events(
        {"input": message, "chat_history": history.messages[-MAX_HISTORY_MESSAGES:]},
        version="v2",
    ):
        kind = event["event"]

        if kind == "on_tool_start":
            yield {"type": "tool_call", "tool": event.get("name", ""), "input": str(event["data"].get("input", ""))}

        elif kind == "on_tool_end":
            tool_name = event.get("name", "")
            if tool_name == "product_search_tool":
                product_search_called = True
                results = _product_search_module.search_results_var.get()
                if results:
                    display = "\n".join(d.get("name", "") for d in results)
                    yield {"type": "tool_result", "content": display}
                    # Keep track of search results for fallback matching
                    pending_products = list(results)
                else:
                    yield {"type": "tool_result", "content": str(event["data"].get("output", ""))}
                # Flush any tokens that arrived before the tool fired
                for buffered in token_buffer:
                    yield buffered
                token_buffer = []
            elif tool_name == "show_product_cards":
                # The agent has explicitly chosen which cards to show
                app_ids = event["data"].get("input", {}).get("app_ids", [])
                # Use pending_products (from search) or the context var to find metadata
                source = pending_products if pending_products else _product_search_module.search_results_var.get()
                explicit_ui_products = [p for p in source if p.get("app_id") in app_ids]
                yield {"type": "tool_result", "content": f"UI updated to show {len(explicit_ui_products)} cards."}
            else:
                yield {"type": "tool_result", "content": str(event["data"].get("output", ""))}

        elif kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            if not hasattr(chunk, "content") or not chunk.content:
                continue
            full_response += chunk.content
            token = {"type": "token", "content": chunk.content}
            if product_search_called:
                yield token
            else:
                # Buffer until we know product_search has been called
                token_buffer.append(token)

    # Safety flush: if product_search was never called, release buffered tokens anyway
    for buffered in token_buffer:
        yield buffered

    # Emit products. 
    # Priority 1: Explicitly chosen by show_product_cards
    # Priority 2: Fallback to reordering based on names in text
    if explicit_ui_products:
        # Reorder explicit ones based on response text just in case, or keep as is
        reordered = _match_products_to_response(explicit_ui_products, full_response)
        yield {"type": "products", "products": reordered if reordered else explicit_ui_products}
    elif pending_products:
        reordered = _match_products_to_response(pending_products, full_response)
        _product_search_module.last_products = reordered
        yield {"type": "products", "products": reordered}

    history.add_user_message(history_override if history_override is not None else message)
    history.add_ai_message(full_response)
