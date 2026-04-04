import os

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tools.product_search import product_search_tool

SYSTEM_PROMPT = """You are a helpful e-commerce shopping assistant.
Use the available tools to help customers find products, answer questions,
and provide recommendations."""

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
    result = await executor.ainvoke({"input": message})
    return result["output"]


async def stream_agent_response(message: str, session_id: str | None = None):
    async for event in executor.astream_events({"input": message}, version="v2"):
        if event["event"] == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            if hasattr(chunk, "content") and chunk.content:
                yield chunk.content
