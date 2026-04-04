import os

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tools.product_search import product_search_tool

_sessions: dict[str, InMemoryChatMessageHistory] = {}


def _get_history(session_id: str | None) -> InMemoryChatMessageHistory:
    if not session_id:
        return InMemoryChatMessageHistory()
    if session_id not in _sessions:
        _sessions[session_id] = InMemoryChatMessageHistory()
    return _sessions[session_id]

SYSTEM_PROMPT = """You are a gaming expert and Steam catalog assistant. \
You help gamers discover games they'll love from the Steam library.

Use the product_search_tool to find relevant games based on the user's request. \
When recommending games, highlight what makes each one worth playing — genre, \
gameplay style, mood, multiplayer options, and value for money. \
Keep responses concise and opinionated, like a friend who's played everything.

If a follow-up narrows the search (e.g. "cheaper ones", "something co-op"), \
use the tool again with a refined query rather than guessing from memory."""

if os.getenv("APP_ENV") == "development":
    llm = ChatOpenAI(
        model="llama3.2:3b",
        base_url=f"{os.getenv('OLLAMA_URL', 'http://ollama:11434')}/v1",
        api_key="ollama",
    )
else:
    llm = ChatOpenAI(
        model="gpt-4o",
        api_key=os.getenv("OPENAI_API_KEY"),
    )

tools = [product_search_tool]

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    MessagesPlaceholder("chat_history", optional=True),
    ("human", "{input}"),
    MessagesPlaceholder("agent_scratchpad"),
])

agent = create_openai_tools_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)


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
        if event["event"] == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            if hasattr(chunk, "content") and chunk.content:
                full_response += chunk.content
                yield chunk.content
    history.add_user_message(message)
    history.add_ai_message(full_response)
