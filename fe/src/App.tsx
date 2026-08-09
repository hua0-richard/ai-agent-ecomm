import { useState, useRef, useEffect } from "react";
import { Swords, Gamepad2, Users, Sparkles, TrendingUp, Zap, Search, HelpCircle, Mic, Image, ArrowUp, ChevronDown, Wrench, Globe, Shuffle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ease: [number, number, number, number] = [0.4, 0, 0.2, 1];

const glass = "glass";

const SEARCH_CATEGORIES = [
  { icon: Swords, label: "Action" },
  { icon: Gamepad2, label: "RPG" },
  { icon: Users, label: "Co-op" },
  { icon: Sparkles, label: "Indie" },
  { icon: TrendingUp, label: "Trending" },
  { icon: Zap, label: "Free to Play" },
  { icon: Search, label: "Deals" },
];

const EXAMPLE_PROMPTS = [
  ["Open world survival with base building", "Cozy farming sim under $15", "Games like Elden Ring"],
  ["Multiplayer FPS with ranked mode", "Story-rich RPG on sale", "Best indie roguelikes 2026"],
  ["Split-screen co-op adventures", "Atmospheric horror games", "Strategy games with mod support"],
];

interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url?: string;
  screenshots?: string;
  similarity?: number;
  app_id?: number;
}

function parseScreenshots(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((s: { path_thumbnail?: string; path_full?: string }) => s.path_thumbnail || s.path_full)
        .filter(Boolean) as string[];
    }
  } catch {
    // ignore
  }
  return [];
}

interface ThoughtStep {
  type: "thought" | "tool_call" | "tool_result";
  content?: string;
  tool?: string;
  input?: string;
}

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  content: string;
  isImage?: boolean;
  imageDataUrl?: string;
  status?: "searching" | "streaming" | "ready" | "error";
  thoughts?: ThoughtStep[];
  results?: Product[];
  /* Reasoning clock: set when the agent turn starts, frozen once it answers */
  startedAt?: number;
  thoughtMs?: number;
}

/** Freeze the reasoning duration the first time the agent produces output. */
function stopThoughtClock(m: ChatMessage): ChatMessage {
  if (m.thoughtMs != null || m.startedAt == null) return m;
  return { ...m, thoughtMs: Date.now() - m.startedAt };
}

function formatThoughtTime(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

/** Still reasoning: steps have arrived but no answer text yet. */
function isThinking(m: ChatMessage): boolean {
  return m.thoughtMs == null && m.status !== "ready" && m.status !== "error";
}

/* ---- Reasoning trace shaping -------------------------------------------- */

type TraceBlock =
  | { kind: "thought"; content: string }
  | { kind: "tool"; tool: string; input?: string; result?: string };

/** A tool call and the result it produced are one unit — pair them up so the
 *  trace reads as [thought] [action → outcome] rather than three flat rows. */
function groupTrace(steps: ThoughtStep[]): TraceBlock[] {
  const blocks: TraceBlock[] = [];
  for (const step of steps) {
    if (step.type === "thought") {
      blocks.push({ kind: "thought", content: step.content ?? "" });
    } else if (step.type === "tool_call") {
      blocks.push({ kind: "tool", tool: step.tool ?? "tool", input: step.input });
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tool" && last.result == null) last.result = step.content;
      else blocks.push({ kind: "tool", tool: "result", result: step.content });
    }
  }
  return blocks;
}

/** search_products -> "Search products" */
function toolLabel(tool: string): string {
  const words = tool.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One-line summary of the step currently in flight. */
function latestTraceLabel(steps: ThoughtStep[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === "tool_call") {
      return step.input
        ? `${toolLabel(step.tool ?? "tool")} · ${step.input}`
        : toolLabel(step.tool ?? "tool");
    }
    if (step.type === "thought" && step.content) return step.content;
  }
  return "Working";
}

function toolIcon(tool: string) {
  const t = tool.toLowerCase();
  if (t.includes("web") || t.includes("tavily") || t.includes("browse")) return Globe;
  if (t.includes("image") || t.includes("vision")) return Image;
  if (t.includes("search") || t.includes("find") || t.includes("product")) return Search;
  return Wrench;
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function App() {
  const [view, setView] = useState<"landing" | "chat">("landing");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [promptSet, setPromptSet] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());

  const sessionIdRef = useRef<string>(crypto.randomUUID());

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const prompts = EXAMPLE_PROMPTS[promptSet % EXAMPLE_PROMPTS.length];

  // Ping backend on mount to trigger cold start/warmup
  useEffect(() => {
    fetch(`${API_URL}/health`).catch(() => {
      // Ignore errors; we're just triggering the cold start
    });
  }, []);

  // Auto-scroll to bottom unless user has scrolled up. The first exchange jumps
  // instantly — a smooth scroll there races the landing→chat layout change.
  useEffect(() => {
    if (userScrolledUp.current) return;
    messagesEndRef.current?.scrollIntoView({
      behavior: messages.length > 2 ? "smooth" : "auto",
    });
  }, [messages, isSearching]);

  function handleChatScroll() {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > 100;
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setQuery(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleFocus() {
    // Proactively warm up the backend when the user starts typing
    fetch(`${API_URL}/health`).catch(() => {});
  }

  function handleImageClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const userMsgId = Date.now().toString();
      const agentMsgId = (Date.now() + 1).toString();
      const currentQuery = `Image: ${file.name}`;
      const imageDataUrl = URL.createObjectURL(file);

      userScrolledUp.current = false;
      setMessages(prev => [...prev, { id: userMsgId, sender: "user", content: currentQuery, isImage: true, imageDataUrl }]);
      setView("chat");
      setIsSearching(true);

      await new Promise(r => setTimeout(r, 300));
      setMessages(prev => [...prev, { id: agentMsgId, sender: "agent", content: "", status: "searching", startedAt: Date.now() }]);

      const formData = new FormData();
      formData.append("file", file);
      if (sessionIdRef.current) formData.append("session_id", sessionIdRef.current);

      try {
        const response = await fetch(`${API_URL}/api/chat/image`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) throw new Error("Request failed");

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "wait" || payload.type === "heartbeat") {
              continue; // Skip keep-alives
            }
            if (payload.type === "done") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...stopThoughtClock(m), status: "ready" } : m));
            } else if (payload.type === "token") {
              fullContent += payload.content;
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...stopThoughtClock(m), content: fullContent, status: "streaming" } : m));
            } else if (payload.type === "products") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, results: payload.products } : m));
            } else if (payload.type === "tool_call") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, thoughts: [...(m.thoughts ?? []), { type: "tool_call", tool: payload.tool, input: payload.input }] } : m));
            } else if (payload.type === "tool_result") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, thoughts: [...(m.thoughts ?? []), { type: "tool_result", content: payload.content }] } : m));
            } else if (payload.type === "error") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...stopThoughtClock(m), content: "Sorry, I had trouble processing that image. Please try again.", status: "error" } : m));
            }
          }
        }
      } catch (err) {
        console.error("Image search failed:", err);
        setMessages(prev => prev.map(m =>
          m.id === agentMsgId
            ? { ...m, content: "Sorry, I had trouble processing that image. Please try again.", status: "error" }
            : m
        ));
      } finally {
        setIsSearching(false);
      }
    }
  }

  async function handleSearch() {
    if (!query.trim() || isSearching) return;
    const currentQuery = query;
    const userMsgId = Date.now().toString();
    const agentMsgId = (Date.now() + 1).toString();

    userScrolledUp.current = false;
    setMessages(prev => [...prev, { id: userMsgId, sender: "user", content: currentQuery }]);
    setQuery("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setView("chat");
    setIsSearching(true);

    await new Promise(r => setTimeout(r, 300));
    setMessages(prev => [...prev, { id: agentMsgId, sender: "agent", content: "", status: "searching", startedAt: Date.now() }]);

    try {
      const response = await fetch(`${API_URL}/api/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentQuery, session_id: sessionIdRef.current }),
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "done") {
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId ? { ...stopThoughtClock(m), status: "ready" } : m
            ));
          } else if (payload.type === "token") {
            fullContent += payload.content;
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId ? { ...stopThoughtClock(m), content: fullContent, status: "streaming" } : m
            ));
          } else if (payload.type === "thought") {
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId
                ? { ...m, thoughts: [...(m.thoughts ?? []), { type: "thought", content: payload.content }] }
                : m
            ));
          } else if (payload.type === "tool_call") {
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId
                ? { ...m, thoughts: [...(m.thoughts ?? []), { type: "tool_call", tool: payload.tool, input: payload.input }] }
                : m
            ));
          } else if (payload.type === "tool_result") {
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId
                ? { ...m, thoughts: [...(m.thoughts ?? []), { type: "tool_result", content: payload.content }] }
                : m
            ));
          } else if (payload.type === "products") {
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId
                ? { ...m, results: payload.products }
                : m
            ));
          } else if (payload.type === "error") {
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId
                ? { ...stopThoughtClock(m), content: "Something went wrong. Please try again.", status: "error" }
                : m
            ));
          }
        }
      }
    } catch (err) {
      console.error("Chat failed:", err);
      setMessages(prev => prev.map(m =>
        m.id === agentMsgId
          ? { ...m, content: "I encountered an error. Please check your connection and try again.", status: "error" }
          : m
      ));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleVoiceToggle() {
    if (isTranscribing) return;

    if (voiceActive) {
      mediaRecorderRef.current?.stop();
      setVoiceActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          setIsTranscribing(true);
          try {
            const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
            const formData = new FormData();
            formData.append("file", blob, "recording.webm");
            const response = await fetch(`${API_URL}/api/voice/transcribe`, {
              method: "POST",
              body: formData,
            });
            const data = await response.json();
            if (data.transcript) {
              setQuery(data.transcript);
              if (textareaRef.current) {
                textareaRef.current.style.height = "auto";
                textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
              }
            }
          } catch (err) {
            console.error("Transcription failed:", err);
          } finally {
            setIsTranscribing(false);
          }
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setVoiceActive(true);
      } catch (err) {
        console.error("Microphone access denied:", err);
      }
    }
  }

  function handleHelpClick() {
    const helpPrompt = "What can you do?";
    setQuery(helpPrompt);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }


  return (
    <div className="h-[100dvh] w-full flex flex-col items-center selection:bg-accent/25 selection:text-white overflow-hidden bg-background">
      <div
          className={`max-w-[680px] w-full px-4 sm:px-6 relative flex flex-col h-full ${view === 'chat' ? 'justify-end py-6' : 'justify-center pt-8 pb-[6vh]'}`}
        >
          {/* Chat / Results history — only occupies space once a conversation exists */}
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className={view === 'chat' ? 'flex-1 min-h-0 overflow-y-auto no-scrollbar mb-6 py-4' : 'hidden'}
          >
            <div className="space-y-6 pb-4">
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="w-full">
                    {msg.sender === 'user' ? (
                      <div className="flex justify-end w-full">
                        <div className={`${glass} bg-surface-raised px-4 py-2.5 rounded-lg max-w-[75%]`}>
                          {msg.imageDataUrl && (
                            <img
                              src={msg.imageDataUrl}
                              alt="Uploaded"
                              className="max-w-[240px] max-h-[180px] rounded-md object-cover mb-2"
                            />
                          )}
                          <p className="text-ink text-[15px] leading-relaxed">{msg.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-1.5 w-full">

                        {/* Reasoning trace — collapsed to a single status line, expands
                            into a plain left-ruled column rather than a boxed timeline */}
                        {msg.thoughts && msg.thoughts.length > 0 && (
                          <div className="w-full">
                            <button
                              onClick={() => setExpandedThoughts(prev => {
                                const next = new Set(prev);
                                if (next.has(msg.id)) next.delete(msg.id);
                                else next.add(msg.id);
                                return next;
                              })}
                              aria-expanded={expandedThoughts.has(msg.id)}
                              className="group flex items-center gap-1.5 text-[12.5px] text-ink-subtle hover:text-ink-muted transition-colors mb-2 cursor-pointer"
                            >
                              {isThinking(msg) ? (
                                <span className="shimmer font-medium">Thinking</span>
                              ) : (
                                <span className="font-medium">
                                  {msg.thoughtMs != null
                                    ? `Thought for ${formatThoughtTime(msg.thoughtMs)}`
                                    : "Reasoning"}
                                </span>
                              )}
                              <span className="text-ink-faint tabular-nums">
                                {(() => {
                                  const n = msg.thoughts.filter(t => t.type === "tool_call").length || msg.thoughts.length;
                                  return `· ${n} step${n === 1 ? "" : "s"}`;
                                })()}
                              </span>
                              <ChevronDown className={`h-3.5 w-3.5 text-ink-faint group-hover:text-ink-subtle transition-transform duration-150 ${expandedThoughts.has(msg.id) ? "" : "-rotate-90"}`} />
                            </button>
                            {/* While collapsed and still running, surface the current step
                                on one truncated line so the height never shifts */}
                            {isThinking(msg) && !expandedThoughts.has(msg.id) && (
                              <p className="mb-2 pl-[3px] text-[12px] text-ink-faint truncate">
                                {latestTraceLabel(msg.thoughts)}
                              </p>
                            )}
                            <AnimatePresence>
                              {expandedThoughts.has(msg.id) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.16, ease }}
                                  className="overflow-hidden mb-3"
                                >
                                  <div className="border-l border-line pl-4 ml-[3px] py-0.5 space-y-3.5">
                                    {groupTrace(msg.thoughts).map((block, i) =>
                                      block.kind === "thought" ? (
                                        <p key={i} className="text-[13px] leading-[1.7] text-ink-subtle whitespace-pre-wrap break-words">
                                          {block.content}
                                        </p>
                                      ) : (
                                        <div key={i} className="rounded-md border border-line bg-surface px-2.5 py-2">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span className="h-[18px] w-[18px] rounded-[5px] bg-accent/15 flex items-center justify-center shrink-0">
                                              {(() => {
                                                const Icon = toolIcon(block.tool);
                                                return <Icon className="h-[11px] w-[11px] text-accent" strokeWidth={2} />;
                                              })()}
                                            </span>
                                            <span className="text-[12px] font-medium text-ink-muted shrink-0">
                                              {toolLabel(block.tool)}
                                            </span>
                                            {block.input && (
                                              <span className="text-[12px] text-ink-faint truncate min-w-0" title={block.input}>
                                                {block.input}
                                              </span>
                                            )}
                                          </div>
                                          {block.result && (
                                            <p className="mt-1.5 pl-[26px] text-[11.5px] leading-[1.55] text-ink-faint line-clamp-2 break-words">
                                              {block.result}
                                            </p>
                                          )}
                                        </div>
                                      )
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {msg.status === 'searching' && !msg.content && !msg.thoughts?.length && (
                          <div className="flex items-center gap-1.5 px-1 pt-1 pb-0.5">
                            {[0, 1, 2].map((i) => (
                              <motion.span
                                key={i}
                                className="block h-[5px] w-[5px] rounded-full bg-ink-subtle"
                                animate={{ opacity: [0.25, 0.8, 0.25] }}
                                transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.16 }}
                              />
                            ))}
                          </div>
                        )}

                        {msg.content && (
                          <div className="w-full px-1 py-1">
                            <div className="text-[15px] leading-[1.7] text-ink text-left [&_p]:my-2.5 [&_ul]:my-2.5 [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:pl-5 [&_li]:my-1 [&_li]:list-disc [&_ol_li]:list-decimal [&_strong]:text-ink [&_strong]:font-semibold [&_code]:text-accent [&_code]:bg-surface-raised [&_code]:px-1.5 [&_code]:rounded [&_code]:text-[13px] [&_code]:tracking-normal [&_h1]:text-ink [&_h2]:text-ink [&_h3]:text-ink [&_h1]:font-semibold [&_h2]:font-semibold [&_h1]:tracking-[-0.02em] [&_h2]:tracking-[-0.02em] [&_h1]:mt-5 [&_h2]:mt-5 [&_h3]:mt-4 [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                              {msg.status === 'streaming' && (
                                <span className="caret-blink inline-block w-[2px] h-[14px] bg-ink-muted ml-0.5 align-middle" />
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Results grid linked to agent message */}
                        {msg.status === 'ready' && msg.results && msg.results.length > 0 && (
                          <div className="grid grid-cols-1 gap-3 mt-4 w-full">
                            {msg.results.map((product) => (
                              <motion.div
                                key={product.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.15 }}
                                className={`${glass} p-4 rounded-lg transition-colors duration-150 flex flex-col gap-3`}
                              >
                                <div className="flex gap-4">
                                  {product.image_url && (
                                    <img src={product.image_url} alt={product.name} className="w-36 h-20 flex-shrink-0 object-cover rounded-md bg-surface" />
                                  )}
                                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                                    <div>
                                      <h3 className="text-ink font-semibold text-[15px] tracking-[-0.02em] leading-snug">{product.name}</h3>
                                      <p className="text-ink-muted text-[13px] line-clamp-2 mt-1.5 leading-[1.55]">{product.description}</p>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                      <span className="text-accent font-semibold text-[14px]">${product.price}</span>
                                      {product.similarity && (
                                        <span className="text-[11px] text-clay bg-clay/[0.1] px-2 py-0.5 rounded border border-clay/25">
                                          {Math.round(product.similarity * 100)}% match
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {(() => {
                                  const shots = parseScreenshots(product.screenshots).slice(0, msg.results!.length);
                                  return shots.length > 0 ? (
                                    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                                      {shots.map((url, si) => (
                                        <img
                                          key={si}
                                          src={url}
                                          alt={`${product.name} screenshot ${si + 1}`}
                                          className="h-28 w-auto flex-shrink-0 rounded-md object-cover bg-surface"
                                        />
                                      ))}
                                    </div>
                                  ) : null;
                                })()}
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Landing prompt. No exit animation on purpose: collapsing its height while
              it is still in the flex column made the heading reflow and appear to stretch. */}
          {view === "landing" && (
              <motion.div
                key="landing-prompt"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18, ease }}
                className="shrink-0 mb-5 px-1"
              >
                <p className="text-[13px] text-ink-subtle tracking-[-0.01em] mb-1.5">Search</p>
                <h1 className="text-[clamp(1.6rem,4.5vw,2.35rem)] font-normal tracking-[-0.025em] text-ink leading-[1.15]">
                  What do you want to play?
                </h1>
              </motion.div>
          )}

          {/* Search Container */}
          <div
            className={`rounded-lg shrink-0 ${glass} transition-[border-color] duration-150 focus-within:border-line z-10`}
          >
            <div className="px-4 pt-4 pb-2">
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => {
                  handleTextareaInput(e);
                  handleFocus();
                }}
                onFocus={handleFocus}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSearch())}
                placeholder="Describe your ideal game..."
                rows={1}
                className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-subtle resize-none outline-none leading-relaxed"
                style={{ minHeight: "28px" }}
              />
            </div>

            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-1">
                <button onClick={handleHelpClick} aria-label="What can this do?" className="h-8 w-8 flex items-center justify-center rounded-md text-ink-subtle hover:text-ink-muted hover:bg-surface-raised transition-colors duration-150 cursor-pointer">
                  <HelpCircle className="h-4 w-4" />
                </button>
                <button onClick={handleImageClick} aria-label="Upload an image" className="h-8 w-8 flex items-center justify-center rounded-md text-ink-subtle hover:text-ink-muted hover:bg-surface-raised transition-colors duration-150 cursor-pointer">
                  <Image className="h-4 w-4" />
                </button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                <button onClick={handleVoiceToggle} disabled={isTranscribing} aria-label={voiceActive ? "Stop recording" : "Record voice search"} className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors duration-150 cursor-pointer ${voiceActive ? "text-accent bg-accent/15" : isTranscribing ? "text-ink-faint" : "text-ink-subtle hover:text-ink-muted hover:bg-surface-raised"}`}>
                  <Mic className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={handleSearch}
                disabled={!query.trim() || isSearching}
                aria-label="Send message"
                className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors duration-150 ${
                  query.trim() && !isSearching
                    ? "cta-frosted cursor-pointer"
                    : "bg-surface text-ink-faint cursor-default"
                }`}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>
          </div>

          {/* Voice indicator */}
          <AnimatePresence>
            {(voiceActive || isTranscribing) && (
              <motion.div
                key="voice-indicator"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 40, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease }}
                className="shrink-0 overflow-hidden flex items-end justify-center"
              >
                <div className="h-7 px-3 flex items-center justify-center gap-2 rounded-md glass-subtle">
                  {isTranscribing ? (
                    <span className="text-[10.5px] text-ink-subtle tracking-wide">Transcribing…</span>
                  ) : (
                    <>
                      {/* scaleY keeps the meter on the compositor instead of relayouting */}
                      <div className="flex items-center gap-[3px] h-3.5">
                        {[0.9, 1.15, 0.8, 1.05, 0.95].map((dur, i) => (
                          <motion.span
                            key={i}
                            className="w-[2px] h-full bg-accent/70 origin-center"
                            animate={{ scaleY: [0.25, 1, 0.25] }}
                            transition={{ duration: dur, delay: i * 0.08, repeat: Infinity, ease: "easeInOut" }}
                          />
                        ))}
                      </div>
                      <span className="text-[10.5px] text-ink-subtle tracking-wide">Listening</span>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {view === "landing" && (
              <motion.div
                key="landing-footer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18, ease }}
                className="shrink-0"
              >
                {/* Category pills — wrap instead of scrolling so nothing is ever clipped */}
                <div className="flex flex-wrap gap-1.5 mt-4 px-1">
                  {SEARCH_CATEGORIES.map((cat) => (
                    <button
                      key={cat.label}
                      onClick={() => setQuery(cat.label + " games")}
                      className={`group inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-md cursor-pointer ${glass}`}
                    >
                      <cat.icon className="h-3.5 w-3.5 text-ink-subtle group-hover:text-ink-muted transition-colors" strokeWidth={1.5} />
                      <span className="text-[12.5px] text-ink-muted group-hover:text-ink transition-colors tracking-[-0.01em]">{cat.label}</span>
                    </button>
                  ))}
                </div>

                {/* Example prompts — a quiet list, visually distinct from the pills above */}
                <div className="mt-5 pt-4 px-1 border-t border-line">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10.5px] uppercase tracking-[0.09em] text-ink-subtle">Try an example</span>
                    <button
                      onClick={() => setPromptSet((s) => s + 1)}
                      aria-label="Show different examples"
                      className="h-7 w-7 -mr-1 flex items-center justify-center rounded-md text-ink-subtle hover:text-ink-muted hover:bg-surface transition-colors cursor-pointer"
                    >
                      <Shuffle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.div key={promptSet} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex flex-col items-start">
                      {prompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => setQuery(prompt)}
                          className="w-full text-left text-[13.5px] text-ink-muted hover:text-ink py-[7px] px-2 -mx-2 rounded-md hover:bg-surface transition-colors cursor-pointer tracking-[-0.01em]"
                        >
                          {prompt}
                        </button>
                      ))}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
          )}
      </div>
    </div>
  );
}

export default App;
