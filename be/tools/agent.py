import os

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

import tools.product_search as _product_search_module
from tools.product_search import product_search_tool
from tools.steam_live import steam_price_tool, steam_player_count_tool, steam_game_details_tool

_sessions: dict[str, InMemoryChatMessageHistory] = {}


def _get_history(session_id: str | None) -> InMemoryChatMessageHistory:
    if not session_id:
        return InMemoryChatMessageHistory()
    if session_id not in _sessions:
        _sessions[session_id] = InMemoryChatMessageHistory()
    return _sessions[session_id]


SYSTEM_PROMPT = """You are a passionate gamer who knows Steam inside out. \
Talk like a real person — casual, direct, and genuinely enthusiastic about games. \
No corporate assistant vibes. No bullet-point dumps unless they actually help. \
Always respond in English regardless of the language the user writes in.

STRICT RULE — NO EXCEPTIONS:
You MUST call product_search_tool before every recommendation, every single time — even if you already know the game, \
even on follow-up turns, even if the user names the game directly. \
If you skip this call, the UI will show no game cards and your entire response becomes useless to the user. \
There is no situation where skipping this tool is acceptable.

PERSONA:
- You have strong opinions and share them. If a game is overrated, say so. If it's a hidden gem, sell it.
- Match the user's energy. Short question → short answer. Deep question → go deeper.
- Use natural transitions in follow-ups ("oh if you liked that...", "yeah that one's a bit different though...").
- Never re-introduce yourself or your capabilities mid-conversation.

TOOLS:
- product_search_tool: find games by genre, vibe, gameplay style, or name. \
  Returns app_ids needed by the Steam tools — never show app_ids to the user.
- steam_game_details_tool: live price, player count, Metacritic, reviews, platforms. \
  Use when the user wants the full picture on a specific game.
- steam_price_tool: current price/discounts only. Use when cost is the specific question.
- steam_player_count_tool: live concurrent players. Use when community size is the question.

CONVERSATION RULES:
- Never show app_ids or raw tool output to the user — translate it into natural language.
- Never narrate what you're doing — no "let me look that up", "give me a sec", "got some options for you", or any \
  commentary about searching or tool use. Just respond with the result directly.
- Never end responses with questions like "which one appeals to you?" or "want more options?" — make a strong \
  recommendation and let the user follow up if they want to. You're a friend, not a support agent.
- Always recommend exactly 3 games — no more, no less. Lead with your top pick and why, then back it up with the other two.
- NEVER ask clarifying questions — not before, not after calling tools. ALWAYS commit to a recommendation. \
  You can mention what assumptions you made ("went with something more story-driven since you didn't specify"), but you must \
  always lead with an actual game recommendation backed by product_search_tool results.
- If the user says "any", "doesn't matter", "surprise me", or is vague — that's your cue to be opinionated. Pick something great and own it.
- Once product_search_tool has been called and returned results, you MUST recommend from those results. Never ask a question instead.
- Honor ALL constraints the user has set in the conversation. If they said "indie", every recommendation must be indie. \
  If they said "no shooters", never suggest a shooter. Treat these as hard filters that persist for the whole session."""

_tools = [product_search_tool, steam_game_details_tool, steam_price_tool, steam_player_count_tool]

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


def _reorder_products_by_response(products: list[dict], response: str) -> list[dict]:
    """Reorder products to match the order their names appear in the LLM response."""
    if not products or not response:
        return products
    response_lower = response.lower()
    # Find the first position each product name appears in the response
    ordered = []
    for p in products:
        name = (p.get("name") or "").lower()
        pos = response_lower.find(name) if name else -1
        ordered.append((pos, p))
    # Products mentioned in the response come first (sorted by position),
    # then any unmentioned products keep their original order
    mentioned = sorted([(pos, p) for pos, p in ordered if pos >= 0], key=lambda x: x[0])
    unmentioned = [p for pos, p in ordered if pos < 0]
    return [p for _, p in mentioned] + unmentioned


async def stream_agent_response(message: str, session_id: str | None = None):
    _product_search_module.last_products = []
    history = _get_history(session_id)
    full_response = ""
    product_search_called = False
    token_buffer: list[dict] = []
    pending_products: list[dict] = []

    async for event in _executor.astream_events(
        {"input": message, "chat_history": history.messages},
        version="v2",
    ):
        kind = event["event"]

        if kind == "on_tool_start":
            yield {"type": "tool_call", "tool": event.get("name", ""), "input": str(event["data"].get("input", ""))}

        elif kind == "on_tool_end":
            tool_name = event.get("name", "")
            if tool_name == "product_search_tool":
                product_search_called = True
                if _product_search_module.last_products:
                    display = "\n".join(d.get("name", "") for d in _product_search_module.last_products)
                    yield {"type": "tool_result", "content": display}
                    # Defer product emission until we have the full response for reordering
                    pending_products = list(_product_search_module.last_products)
                else:
                    yield {"type": "tool_result", "content": str(event["data"].get("output", ""))}
                # Flush any tokens that arrived before the tool fired
                for buffered in token_buffer:
                    yield buffered
                token_buffer = []
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

    # Emit products reordered to match the LLM's response
    if pending_products:
        reordered = _reorder_products_by_response(pending_products, full_response)
        _product_search_module.last_products = reordered
        yield {"type": "products", "products": reordered}

    history.add_user_message(message)
    history.add_ai_message(full_response)
