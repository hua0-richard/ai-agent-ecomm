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
Before recommending any game(s), you MUST call product_search_tool first. \
Every single time. Even if you already know the game. Even on follow-up turns. \
This is non-negotiable — the UI cannot show game images or cards without it.

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
- When recommending, lead with your take, then back it up with details. Don't just list games.
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
        model=os.getenv("OPENROUTER_MODEL", "anthropic/claude-3.5-sonnet"),
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


async def stream_agent_response(message: str, session_id: str | None = None):
    _product_search_module.last_products = []
    history = _get_history(session_id)
    full_response = ""

    async for event in _executor.astream_events(
        {"input": message, "chat_history": history.messages},
        version="v2",
    ):
        kind = event["event"]

        if kind == "on_tool_start":
            yield {"type": "tool_call", "tool": event.get("name", ""), "input": str(event["data"].get("input", ""))}

        elif kind == "on_tool_end":
            tool_name = event.get("name", "")
            if tool_name == "product_search_tool" and _product_search_module.last_products:
                display = "\n".join(d.get("name", "") for d in _product_search_module.last_products)
                yield {"type": "tool_result", "content": display}
                yield {"type": "products", "products": _product_search_module.last_products}
            else:
                yield {"type": "tool_result", "content": str(event["data"].get("output", ""))}

        elif kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            if not hasattr(chunk, "content") or not chunk.content:
                continue
            full_response += chunk.content
            yield {"type": "token", "content": chunk.content}

    history.add_user_message(message)
    history.add_ai_message(full_response)
