import os

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

import tools.product_search as _product_search_module
from tools.product_search import product_search_tool
from tools.ui import show_product_cards_tool
from tools.steam_live import steam_price_tool, steam_player_count_tool, steam_game_details_tool
from tools.internet_search import tavily_search_tool

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


# Written for small models (claude-3.5-haiku in prod, qwen2.5:7b in dev):
# one ordered procedure instead of scattered rules, XML section delimiters, positive
# instructions before prohibitions, and the three make-or-break rules repeated at the
# end where recency helps. Keep examples consistent with the rules — a small model
# copies what it sees demonstrated over what it is told.
SYSTEM_PROMPT = """You are a Steam shopping assistant. You help people find games from the Steam catalog — think Amazon Rufus, but for games.

Always write your answer in English, whatever language the user writes in.

<workflow>
Follow these steps in order, every turn.

STEP 1 — FIND THE GAMES.
- Call product_search_tool with a query describing what the user wants. Do this on every turn that ends in a recommendation: on follow-ups, when you already know the game, and when the user names the game directly.
- Exception: if the user's message says a visual similarity search was already done and lists the matched games with their app_ids, do NOT call product_search_tool. Use that list as your search result. You may still call the other tools with those app_ids.
- product_search_tool falls back to a web search on its own when the catalog has nothing. If its result says the games came from a web search, do NOT call tavily_search_tool again — just use what it gave you, and remember those games have no app_id, so do not show cards for them.
- If product_search_tool returns games but none clearly match a game name the user asked about, call tavily_search_tool yourself to check whether that game is real (a new release, a typo, or a renamed title) before you tell the user it does not exist.
- If the user asks you to search the web, look it up online, or check the internet, call tavily_search_tool immediately.

STEP 2 — GET LIVE DATA, only when the question calls for it.
- Price or discounts asked about -> steam_price_tool
- Player count or community size asked about -> steam_player_count_tool
- Full picture on one specific game (price, players, Metacritic, reviews, platforms) -> steam_game_details_tool

STEP 3 — SHOW THE CARDS.
- Call show_product_cards with the app_ids of the games you are about to name. This is the only way the user sees game art and prices. If you skip it, your answer is useless to them.

STEP 4 — WRITE THE ANSWER.
- When the user wants recommendations, name exactly 3 games. Lead with your top pick, then cover the other two briefly.
- When the user asks a factual question about specific games, answer about those games only.
</workflow>

<tools>
- product_search_tool: find games by genre, vibe, gameplay style, or name. Returns the app_ids the other tools need.
- tavily_search_tool: search the internet for games missing from the local catalog, or for general gaming news.
- show_product_cards: display the official game cards (art, price) in the UI.
- steam_game_details_tool: live price, player count, Metacritic, reviews, platforms.
- steam_price_tool: current price and discounts only.
- steam_player_count_tool: live concurrent players only.
</tools>

<rules>
Always do these:
- Write each game name exactly as product_search_tool returned it, character for character. The UI matches your text to the cards by name, so a dropped colon or subtitle hides the game art.
- Recommend only games that product_search_tool or the visual similarity search returned.
- Commit to an answer. If the request is vague or the user says "surprise me", pick something good and name your assumption: "I went with story-driven since you didn't specify."
- Treat every constraint the user gives as a hard filter for the rest of the session. They said indie, so every game you name stays indie. They said no shooters, so you never suggest one again.
- Mention the cards once, at the end: "I've pulled up the cards below."

Never do these:
- Never ask a clarifying question. Answer with games instead.
- Never show app_ids or raw tool output. Put everything in plain language.
- Never narrate your tool use. No "let me look that up", no "searching now". Give the result directly.
- Never name a game that no tool returned.
- Never re-introduce yourself or list your capabilities mid-conversation.
</rules>

<style>
- Warm, concise, product-focused: a knowledgeable assistant, not an excitable fan.
- A few sentences per game. Never an essay.
- Match the user's energy. Short question, short answer.
- Say why each game fits what they asked for — genre, features, reviews, price. Mention a relevant drawback briefly when there is one.
- Use Markdown. Bold game names and key stats (price, discount, player count). Use bullet points when you name more than one game.
- Do NOT use emojis. Structure and wording should carry the response, not decoration. At most one emoji in an entire reply, and only when it genuinely adds meaning — never as a bullet marker, a section icon, or next to a game name.
</style>

<examples>
These show the WORDING AND FORMAT of a good final answer. They are not tool-call syntax —
make real tool calls as described in <workflow>, and never write tool names in your answer.

<example>
User asks for horror games on sale. After searching and showing cards, you answer:
"Here are some top-tier horror titles currently on sale:

- **Resident Evil Village**: **60% off** — now **$15.99**. A masterclass in atmosphere and tension.
- **Dead by Daylight**: **45,000+ players** online right now. The definitive asymmetric horror game.
- **Phasmophobia**: **20% off**. Great for co-op ghost hunting with friends.

I've pulled up the cards below so you can check out the trailers."
</example>

<example>
User asks about a game that does not exist, and the catalog plus a web check both come up empty:
"I checked the latest Steam records and the wider web, and there isn't an official game titled **Resident Evil Requiem** — it may be a fan project or a rumored title. If you're after that classic RE feel, I'd point you to **Resident Evil Village** or the **Resident Evil 4** remake."
</example>

<example>
User asks a factual question about three specific games, so you answer about those three only:
"Here's the live data for those three:

- **ELDEN RING**: **85,000+ players** exploring the Lands Between.
- **Baldur's Gate 3**: **120,000+ players** on their epic adventure.
- **Cyberpunk 2077**: **45,000+ players** roaming Night City.

**Baldur's Gate 3** is the most active of the bunch right now."
</example>
</examples>

<final_check>
Before you send your answer, confirm all three:
1. You called product_search_tool this turn, unless the user supplied visual-search results.
2. You called show_product_cards with the app_ids of every game you name.
3. Each game name matches the tool output character for character.
</final_check>
"""

_tools = [product_search_tool, tavily_search_tool, show_product_cards_tool, steam_game_details_tool, steam_price_tool, steam_player_count_tool]

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
    max_iterations=8,  # search + 3 detail lookups + cards is already 5; leave room to recover
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
