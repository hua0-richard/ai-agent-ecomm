import { useState, useRef, useEffect } from "react";
import { Swords, Gamepad2, Users, Sparkles, TrendingUp, Zap, Search, ChevronLeft, ChevronRight, HelpCircle, Mic, Image, Send, ChevronDown, Wrench, Shuffle } from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ease: [number, number, number, number] = [0.4, 0, 0.2, 1];

const glass = "glass";
const glassHover = "";

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
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function App() {
  const [view, setView] = useState<"landing" | "chat">("landing");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [promptSet, setPromptSet] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());

  const sessionIdRef = useRef<string>(crypto.randomUUID());

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [glowVisible, setGlowVisible] = useState(false);

  const prompts = EXAMPLE_PROMPTS[promptSet % EXAMPLE_PROMPTS.length];

  // Auto-scroll to bottom unless user has scrolled up
  useEffect(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isSearching]);

  function handleChatScroll() {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > 100;
  }

  function scrollCategories(dir: number) {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setQuery(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
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
      setLastQuery(currentQuery);
      setView("chat");
      setIsSearching(true);

      await new Promise(r => setTimeout(r, 300));
      setMessages(prev => [...prev, { id: agentMsgId, sender: "agent", content: "", status: "searching" }]);

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
            if (payload.type === "done") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, status: "ready" } : m));
            } else if (payload.type === "token") {
              fullContent += payload.content;
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: fullContent, status: "streaming" } : m));
            } else if (payload.type === "products") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, results: payload.products } : m));
            } else if (payload.type === "tool_call") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, thoughts: [...(m.thoughts ?? []), { type: "tool_call", tool: payload.tool, input: payload.input }] } : m));
            } else if (payload.type === "tool_result") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, thoughts: [...(m.thoughts ?? []), { type: "tool_result", content: payload.content }] } : m));
            } else if (payload.type === "error") {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: "Sorry, I had trouble processing that image. Please try again.", status: "error" } : m));
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
    setLastQuery(currentQuery);
    setQuery("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setView("chat");
    setIsSearching(true);

    await new Promise(r => setTimeout(r, 300));
    setMessages(prev => [...prev, { id: agentMsgId, sender: "agent", content: "", status: "searching" }]);

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
              m.id === agentMsgId ? { ...m, status: "ready" } : m
            ));
          } else if (payload.type === "token") {
            fullContent += payload.content;
            setMessages(prev => prev.map(m =>
              m.id === agentMsgId ? { ...m, content: fullContent, status: "streaming" } : m
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
                ? { ...m, content: "Something went wrong. Please try again.", status: "error" }
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

  const fastSpring = { type: "spring" as const, stiffness: 400, damping: 38, mass: 1 };

  return (
    <div
      className="h-[100dvh] w-full flex flex-col items-center selection:bg-steam-blue/20 selection:text-white overflow-hidden bg-background"
      onMouseMove={(e) => {
        setMousePos({ x: e.clientX, y: e.clientY });
        const target = e.target as HTMLElement;
        const overInteractive = !!target.closest(".glass, textarea, button, a, input");
        setGlowVisible(!overInteractive);
      }}
    >
      {/* Background Decor */}
      <div
        className="fixed pointer-events-none transition-[opacity] duration-[1000ms] ease-out"
        style={{
          left: mousePos.x - 200,
          top: mousePos.y - 200,
          width: 400,
          height: 400,
          background: "radial-gradient(circle, rgba(26,159,255,0.025) 0%, transparent 60%)",
          opacity: glowVisible && (mousePos.x !== 0 || mousePos.y !== 0) ? 1 : 0,
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 85% 85% at 50% 50%, black 35%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 85% 85% at 50% 50%, black 35%, transparent 100%)",
        }}
      />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[800px] h-[500px] bg-[radial-gradient(ellipse_at_center,rgba(26,159,255,0.06)_0%,transparent_70%)] pointer-events-none" />

      <LayoutGroup>
        <motion.div 
          layout
          transition={fastSpring}
          className={`max-w-[680px] w-full px-4 sm:px-6 py-8 relative flex flex-col h-full ${view === 'chat' ? 'justify-end' : 'justify-center'}`}
        >
          <AnimatePresence>
            {view === "landing" && (
              <motion.div
                key="landing-hero"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40, filter: "blur(10px)", height: 0, marginBottom: 0, overflow: 'hidden' }}
                transition={{ duration: 0.4, ease }}
                className="text-center mb-8 shrink-0"
              >
                <div className="flex items-center justify-center mb-5">
                  <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl glass-subtle">
                    <svg className="w-7 h-7 text-white/65" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
                    </svg>
                    <div className="w-px h-4 bg-white/10" />
                    <div className="flex items-center gap-2">
                      <span className="text-[1.1rem] font-semibold tracking-[0.1em] uppercase leading-none text-white/75">GABEN</span>
                      <span className="h-2 w-2 rounded-full bg-[#6abf47]/80 animate-[pulse_3s_ease-in-out_infinite] shadow-[0_0_8px_2px_rgba(106,191,71,0.4)]" />
                    </div>
                  </div>
                </div>
                <h1
                  className="text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.04em] mb-0"
                  style={{
                    background: "linear-gradient(135deg, #ffffff 0%, rgba(180, 220, 255, 0.92) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Like having a friend who's played everything.
                </h1>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat / Results history */}
          <div ref={chatScrollRef} onScroll={handleChatScroll} className={`flex-1 overflow-y-auto no-scrollbar min-h-0 ${view === 'chat' ? 'mb-6 py-4' : ''}`}>
            <div className="space-y-6 pb-4">
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease }}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="w-full">
                    {msg.sender === 'user' ? (
                      <div className="flex justify-end w-full">
                        <div className={`${glass} bg-white/[0.06] px-4 py-2.5 rounded-2xl border-white/8 shadow-lg max-w-[75%]`}>
                          {msg.imageDataUrl && (
                            <img
                              src={msg.imageDataUrl}
                              alt="Uploaded"
                              className="max-w-[240px] max-h-[180px] rounded-lg object-cover mb-2"
                            />
                          )}
                          <p className="text-white/90 text-[15px] font-medium leading-relaxed">{msg.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-1.5 w-full">
                        <div className="flex items-center gap-2 ml-1">
                          <motion.span
                            className="h-1 w-1 rounded-full bg-[#6abf47]"
                            animate={msg.status === 'streaming' ? {
                              opacity: [0.4, 1, 0.4],
                              scale: [0.8, 1.5, 0.8],
                              boxShadow: ["0 0 2px 0px rgba(106,191,71,0.2)", "0 0 6px 2px rgba(106,191,71,0.5)", "0 0 2px 0px rgba(106,191,71,0.2)"],
                            } : {
                              opacity: 0.4,
                              scale: 1,
                              boxShadow: "0 0 3px 0px rgba(106,191,71,0.2)",
                            }}
                            transition={{ duration: 1.6, repeat: msg.status === 'streaming' ? Infinity : 0, ease: "easeInOut" }}
                          />
                          <span className="text-[10px] font-medium text-white/30 tracking-[0.08em] uppercase">Gaben</span>
                        </div>

                        {/* Collapsible chain-of-thought */}
                        {msg.thoughts && msg.thoughts.length > 0 && (
                          <div className="w-full">
                            <button
                              onClick={() => setExpandedThoughts(prev => {
                                const next = new Set(prev);
                                next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id);
                                return next;
                              })}
                              className="flex items-center gap-1.5 text-[10px] text-white/20 hover:text-white/45 transition-colors mb-1.5 cursor-pointer tracking-wide"
                            >
                              <motion.div animate={{ rotate: expandedThoughts.has(msg.id) ? 0 : -90 }} transition={{ duration: 0.2 }}>
                                <ChevronDown className="h-3 w-3" />
                              </motion.div>
                              View reasoning
                            </button>
                            <AnimatePresence>
                              {expandedThoughts.has(msg.id) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden mb-2"
                                >
                                  <div className="border border-white/5 rounded-xl p-3 space-y-2 bg-white/[0.02]">
                                    {msg.thoughts.map((step, i) => (
                                      <div key={i} className="text-[11px] leading-relaxed">
                                        {step.type === "thought" && (
                                          <p className="text-white/30 font-mono whitespace-pre-wrap">{step.content}</p>
                                        )}
                                        {step.type === "tool_call" && (
                                          <div className="flex items-start gap-2">
                                            <Wrench className="h-3 w-3 text-steam-blue/50 mt-0.5 shrink-0" />
                                            <div>
                                              <span className="text-steam-blue/60 font-medium">{step.tool}</span>
                                              {step.input && <p className="text-white/25 mt-0.5">"{step.input}"</p>}
                                            </div>
                                          </div>
                                        )}
                                        {step.type === "tool_result" && (
                                          <p className="text-white/20 font-mono line-clamp-3">{step.content}</p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {msg.status === 'searching' && !msg.content && (
                          <div className="flex items-center gap-2 px-4 pt-1 pb-0.5">
                            {[0, 1, 2].map((i) => (
                              <motion.span
                                key={i}
                                className="block h-[5px] w-[5px] rounded-full bg-white/30"
                                animate={{ opacity: [0.2, 0.8, 0.2], y: [0, -4, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                              />
                            ))}
                          </div>
                        )}

                        {msg.content && (
                          <div className={`${glass} bg-steam-blue/[0.04] px-4 py-3.5 rounded-2xl border-white/[0.06] w-full`}>
                            <div className="text-[15px] leading-[1.75] text-white/75 text-left [&_p]:my-2 [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:my-1 [&_li]:list-disc [&_ol_li]:list-decimal [&_strong]:text-white/90 [&_strong]:font-semibold [&_code]:text-steam-blue/90 [&_code]:bg-white/[0.08] [&_code]:px-1.5 [&_code]:rounded [&_code]:text-[13px] [&_code]:tracking-normal [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white/85 [&_h1]:font-semibold [&_h2]:font-semibold [&_h1]:tracking-[-0.02em] [&_h2]:tracking-[-0.02em] [&_a]:text-steam-blue/80 [&_a]:underline [&_a]:underline-offset-2">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                              {msg.status === 'streaming' && (
                                <motion.span
                                  className="inline-block w-[2px] h-[14px] bg-white/40 rounded-full ml-0.5 align-middle"
                                  animate={{ opacity: [1, 0, 1] }}
                                  transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                                />
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Results grid linked to agent message */}
                        {msg.status === 'ready' && msg.results && msg.results.length > 0 && (
                          <div className="grid grid-cols-1 gap-3 mt-4 w-full">
                            {msg.results.map((product, i) => (
                              <motion.div
                                layout
                                key={product.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.08 + i * 0.06, duration: 0.3, ease }}
                                className={`${glass} p-4 rounded-2xl border border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.025] hover:shadow-[0_4px_16px_rgba(0,0,0,0.18)] transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] flex flex-col gap-3`}
                              >
                                <div className="flex gap-4">
                                  {product.image_url && (
                                    <img src={product.image_url} alt={product.name} className="w-36 h-20 flex-shrink-0 object-cover rounded-xl bg-white/5" />
                                  )}
                                  <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                                    <div>
                                      <h3 className="text-white/92 font-semibold text-[15px] tracking-[-0.02em] leading-snug">{product.name}</h3>
                                      <p className="text-white/45 text-[13px] line-clamp-2 mt-1.5 leading-[1.55]">{product.description}</p>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                      <span className="text-steam-blue/80 font-semibold text-[14px]">${product.price}</span>
                                      {product.similarity && (
                                        <span className="text-[11px] text-white/25 px-2 py-0.5 rounded-full border border-white/[0.07]">
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
                                          className="h-28 w-auto flex-shrink-0 rounded-xl object-cover bg-white/5"
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

          {/* Search Container */}
          <motion.div
            layout
            layoutId="search-box"
            transition={fastSpring}
            className={`rounded-2xl shrink-0 ${glass} transition-[box-shadow,border-color] duration-300 focus-within:border-[rgba(160,210,255,0.22)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(255,255,255,0.03),0_0_48px_rgba(26,159,255,0.07),0_0_120px_rgba(26,159,255,0.04),0_4px_24px_rgba(0,0,0,0.3)] z-10`}
          >
            <div className="px-4 pt-4 pb-2">
              <textarea
                ref={textareaRef}
                value={query}
                onChange={handleTextareaInput}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSearch())}
                placeholder="Describe your ideal game..."
                rows={1}
                className="w-full bg-transparent text-[15px] font-medium text-white/90 placeholder:text-white/25 resize-none outline-none leading-relaxed"
                style={{ minHeight: "28px" }}
              />
            </div>

            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-1">
                <button onClick={handleHelpClick} className="h-8 w-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all duration-200 cursor-pointer">
                  <HelpCircle className="h-4 w-4" />
                </button>
                <button onClick={handleImageClick} className="h-8 w-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all duration-200 cursor-pointer">
                  <Image className="h-4 w-4" />
                </button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                <button onClick={handleVoiceToggle} disabled={isTranscribing} className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer ${voiceActive ? "text-steam-blue bg-steam-blue/10" : isTranscribing ? "text-white/20" : "text-white/30 hover:text-white/60 hover:bg-white/[0.06]"}`}>
                  <Mic className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <AnimatePresence>
                  {query.trim() && (
                    <motion.span
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 4 }}
                      transition={{ duration: 0.15 }}
                      className="text-[11px] text-white/20 select-none"
                    >
                      ↵
                    </motion.span>
                  )}
                </AnimatePresence>
                <motion.button
                  onClick={handleSearch}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`h-9 w-9 flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer ${query.trim() ? "cta-frosted" : "bg-white/[0.06] text-white/20"}`}
                >
                  <Send className="h-4 w-4" />
                </motion.button>
              </div>
            </div>
          </motion.div>

          {/* Voice indicator — container animates height once on enter/exit; bar animations are contained inside */}
          <motion.div
            className="shrink-0 overflow-hidden"
            animate={{ height: (voiceActive || isTranscribing) ? 48 : 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 8 }}
          >
          <AnimatePresence>
            {(voiceActive || isTranscribing) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                className="w-32"
              >
                {isTranscribing ? (
                  <div className="w-full h-7 flex items-center justify-center gap-2 rounded-full glass-subtle">
                    <motion.div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{
                        background: "conic-gradient(from 0deg, transparent 0%, rgba(26,159,255,0.1) 25%, rgba(26,159,255,0.65) 70%, transparent 100%)",
                        mask: "radial-gradient(circle, transparent 51%, black 53%)",
                        WebkitMask: "radial-gradient(circle, transparent 51%, black 53%)",
                      }}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                    />
                    <span className="text-[10px] font-medium text-white/35 tracking-wide">Transcribing</span>
                  </div>
                ) : (
                  <div className="w-full h-7 flex items-center justify-center gap-2.5 rounded-full glass-subtle">
                    <div className="flex items-center gap-[3px] h-5">
                      {([
                        { w: 1,   dur: 0.75, h: [2,  8, 2]  },
                        { w: 1.5, dur: 1.0,  h: [3, 14, 3]  },
                        { w: 1,   dur: 0.82, h: [2,  7, 2]  },
                        { w: 2,   dur: 1.12, h: [4, 17, 4]  },
                        { w: 1,   dur: 0.88, h: [3, 11, 3]  },
                        { w: 1.5, dur: 0.96, h: [3, 13, 3]  },
                        { w: 1,   dur: 0.7,  h: [2,  7, 2]  },
                      ] as { w: number; dur: number; h: number[] }[]).map((bar, i) => (
                        <motion.div
                          key={i}
                          className="rounded-full bg-steam-blue/45"
                          style={{ width: bar.w }}
                          animate={{ height: bar.h }}
                          transition={{ duration: bar.dur, delay: i * 0.04, repeat: Infinity, ease: "easeInOut", repeatType: "mirror" }}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-medium text-white/35 tracking-wide">Listening</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          </motion.div>

          <AnimatePresence>
            {view === "landing" && (
              <motion.div
                key="landing-footer"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20, filter: "blur(8px)", height: 0, marginTop: 0, overflow: 'hidden' }}
                transition={{ duration: 0.4, ease }}
                className="shrink-0"
              >
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => scrollCategories(-1)} className="hidden sm:flex flex-shrink-0 h-8 w-8 items-center justify-center text-white/25 hover:text-white/50 transition-colors cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
                  <div ref={scrollRef} className="flex gap-2 overflow-x-auto scroll-smooth" style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
                    {SEARCH_CATEGORIES.map((cat) => (
                      <button key={cat.label} onClick={() => setQuery(cat.label + " games")} className={`flex-shrink-0 flex flex-col items-center gap-1.5 w-20 py-3 rounded-xl cursor-pointer group transition-all duration-200 ${glass} ${glassHover}`}>
                        <cat.icon className="h-5 w-5 text-white/25 group-hover:text-white/60 transition-colors" strokeWidth={1.5} />
                        <span className="text-[11px] font-medium text-white/45 group-hover:text-white/75 transition-colors tracking-[-0.01em]">{cat.label}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => scrollCategories(1)} className="hidden sm:flex flex-shrink-0 h-8 w-8 items-center justify-center text-white/25 hover:text-white/50 transition-colors cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
                </div>

                <div className="mt-6 text-center pb-8">
                  <button onClick={() => setPromptSet((s) => s + 1)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/30 hover:text-white/55 mb-3 cursor-pointer group transition-colors duration-200">
                    <Shuffle className="h-3 w-3 group-hover:text-white/55 transition-colors duration-200" />
                    Try an example
                  </button>
                  <AnimatePresence mode="wait">
                    <motion.div key={promptSet} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="flex flex-wrap justify-center gap-2">
                      {prompts.map((prompt) => (
                        <button key={prompt} onClick={() => setQuery(prompt)} className={`text-[13px] font-medium text-white/45 hover:text-white/80 px-3.5 py-2 rounded-xl cursor-pointer transition-all duration-200 tracking-[-0.01em] hover:-translate-y-0.5 ${glass} ${glassHover}`}>{prompt}</button>
                      ))}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>
    </div>
  );
}

export default App;
