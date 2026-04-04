import os

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

import tools.product_search as _product_search_module
from tools.product_search import product_search_tool

_sessions: dict[str, InMemoryChatMessageHistory] = {}


def _get_history(session_id: str | None) -> InMemoryChatMessageHistory:
    if not session_id:
        return InMemoryChatMessageHistory()
    if session_id not in _sessions:
        _sessions[session_id] = InMemoryChatMessageHistory()
    return _sessions[session_id]

SYSTEM_PROMPT = """You are a gaming expert and Steam catalog assistant. \
You help gamers discover games they'll love from the Steam library. \
Always respond in English regardless of the language the user writes in.

Always use product_search_tool to find games. Extract the key search terms \
directly from the user's message — if they ask for "horror games under $20", \
search for "horror games". Never reuse a previous query for a new request.

You may call product_search_tool multiple times with different queries to \
broaden or refine results — for example, searching "co-op horror" and then \
"survival horror multiplayer" to get better coverage.

When recommending games, highlight what makes each one worth playing — genre, \
gameplay style, mood, multiplayer options, and value for money. \
Keep responses concise and opinionated, like a friend who's played everything."""

tools = [product_search_tool]

prompt = ChatPromptTemplate.from_messages([
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

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,
    max_iterations=5,
    max_execution_time=60,
    handle_parsing_errors=True,
)


async def get_agent_response(message: str, session_id: str | None = None) -> str:
    history = _get_history(session_id)
    result = await executor.ainvoke({
        "input": message,
        "chat_history": history.messages,
    })
    history.add_user_message(message)
    history.add_ai_message(result["output"])
    return result["output"]


async def stream_agent_response(message: str, session_id: str | None = None):
    history = _get_history(session_id)
    full_response = ""

    async for event in executor.astream_events(
        {"input": message, "chat_history": history.messages},
        version="v2",
    ):
        kind = event["event"]

        if kind == "on_tool_start":
            yield {"type": "tool_call", "tool": event.get("name", ""), "input": str(event["data"].get("input", ""))}

        elif kind == "on_tool_end":
            yield {"type": "tool_result", "content": str(event["data"].get("output", ""))}
            if _product_search_module.last_products:
                yield {"type": "products", "products": _product_search_module.last_products}

        elif kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            if not hasattr(chunk, "content") or not chunk.content:
                continue
            full_response += chunk.content
            yield {"type": "token", "content": chunk.content}

    history.add_user_message(message)
    history.add_ai_message(full_response)
