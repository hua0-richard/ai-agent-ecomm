import { useState, useRef, useEffect } from "react";
import { Swords, Gamepad2, Users, Sparkles, TrendingUp, Zap, Search, ChevronLeft, ChevronRight, HelpCircle, Mic, Image, Send, ChevronDown, Wrench } from "lucide-react";
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [glowVisible, setGlowVisible] = useState(false);

  const prompts = EXAMPLE_PROMPTS[promptSet % EXAMPLE_PROMPTS.length];

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSearching]);

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

      // 1. Add user message and transition view
      setMessages(prev => [...prev, { id: userMsgId, sender: "user", content: currentQuery, isImage: true, imageDataUrl }]);
      setLastQuery(currentQuery);
      setView("chat");
      setIsSearching(true);
      
      const formData = new FormData();
      formData.append("file", file);

      try {
        const minDelay = new Promise((r) => setTimeout(r, 2000));
        
        // 2. Short delay before showing "Thinking..."
        await new Promise(r => setTimeout(r, 500));
        setMessages(prev => [...prev, { id: agentMsgId, sender: "agent", content: "Thinking...", status: "searching" }]);

        const response = await fetch(`${API_URL}/api/search/image`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        const searchResults = data.results || [];
        
        await minDelay;
        
        // 3. Update the agent message with real results
        setMessages(prev => prev.map(m =>
          m.id === agentMsgId
            ? { ...m, content: "I've analyzed your image and found these matching games from the Steam library.", status: "ready", results: searchResults }
            : m
        ));
      } catch (err) {
        console.error("Search failed:", err);
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
        body: JSON.stringify({ message: currentQuery }),
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

  const fastSpring = { type: "spring", stiffness: 400, damping: 38, mass: 1 };

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
                className="text-center mb-10 shrink-0"
              >
                <div className="flex items-center justify-center gap-3 mb-6">
                  <svg className="w-12 h-12 text-white/80" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
                  </svg>
                  <div className="flex items-center gap-2 text-white/80">
                    <span className="text-[2rem] font-semibold tracking-[0.05em] uppercase leading-none">GABEN</span>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#6abf47]/70 animate-[pulse_3s_ease-in-out_infinite] shadow-[0_0_10px_2px_rgba(106,191,71,0.4)]" />
                  </div>
                </div>
                <h1 className="text-[clamp(1.75rem,4vw,2.75rem)] font-semibold text-white tracking-[-0.03em] mb-3">
                  Like having a friend who's played everything.
                </h1>
                <p className="text-white/40 text-[15px] max-w-sm mx-auto leading-relaxed">
                  Ask anything. Get genuine recommendations.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat / Results history */}
          <div className={`flex-1 overflow-y-auto no-scrollbar min-h-0 ${view === 'chat' ? 'mb-6 py-4' : ''}`}>
            <div className="space-y-8 pb-4">
              {messages.map((msg, index) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="flex flex-col gap-1.5 max-w-[90%] w-full">
                    {msg.sender === 'user' ? (
                      <div className="flex flex-col items-end gap-1.5 text-right w-full relative">
                        {index === messages.length - 1 && isSearching && (
                          <div className="absolute -left-8 top-1/2 -translate-y-1/2">
                            <motion.div
                              className="w-4 h-4 rounded-full"
                              style={{
                                background: "conic-gradient(from 0deg, transparent 0%, rgba(26,159,255,0.1) 20%, rgba(26,159,255,0.5) 60%, transparent 100%)",
                                mask: "radial-gradient(circle, transparent 50%, black 52%)",
                                WebkitMask: "radial-gradient(circle, transparent 50%, black 52%)",
                              }}
                              animate={{ rotate: 360 }}
                              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            />
                          </div>
                        )}
                        <span className="text-[10px] font-bold text-white/20 tracking-widest uppercase mr-1">User</span>
                        <div className={`${glass} bg-white/[0.08] px-4 py-2.5 rounded-2xl border-white/10 shadow-xl`}>
                          {msg.imageDataUrl && (
                            <img
                              src={msg.imageDataUrl}
                              alt="Uploaded"
                              className="max-w-[240px] max-h-[180px] rounded-lg object-cover mb-2"
                            />
                          )}
                          <p className="text-white/90 text-sm font-medium text-left leading-relaxed">{msg.content}</p>
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
                          <span className="text-[10px] font-bold text-steam-blue/40 tracking-widest uppercase">Gaben</span>
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
                              className="flex items-center gap-1.5 text-[11px] text-white/25 hover:text-white/50 transition-colors mb-1.5 cursor-pointer"
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

                        <div className={`${glass} bg-steam-blue/20 px-4 py-3 rounded-2xl border-steam-blue/30 shadow-[0_0_30px_rgba(26,159,255,0.1)] w-full`}>
                          {msg.status === 'searching' ? (
                            <div className="flex items-center justify-center h-5 px-1">
                              <motion.div
                                className="w-5 h-5 rounded-full"
                                style={{
                                  background: "conic-gradient(from 0deg, transparent 0%, rgba(26,159,255,0.08) 20%, rgba(26,159,255,0.7) 55%, rgba(160,220,255,0.9) 70%, transparent 100%)",
                                  mask: "radial-gradient(circle, transparent 53%, black 55%)",
                                  WebkitMask: "radial-gradient(circle, transparent 53%, black 55%)",
                                }}
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                              />
                            </div>
                          ) : (
                            <div className="text-sm leading-relaxed text-left [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&_li]:my-0.5 [&_li]:list-disc [&_ol_li]:list-decimal [&_strong]:text-white [&_strong]:font-semibold [&_code]:text-steam-blue [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white/90 [&_h1]:font-semibold [&_h2]:font-semibold [&_a]:text-steam-blue [&_a]:underline">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                        
                        {/* Results grid linked to agent message */}
                        {msg.status === 'ready' && msg.results && msg.results.length > 0 && (
                          <div className="grid grid-cols-1 gap-4 mt-4 w-full">
                            {msg.results.map((product, i) => (
                              <motion.div
                                layout
                                key={product.id}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 + i * 0.04 }}
                                className={`${glass} p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors flex flex-col gap-3`}
                              >
                                <div className="flex gap-4">
                                  {product.image_url && (
                                    <img src={product.image_url} alt={product.name} className="w-20 h-20 flex-shrink-0 object-cover rounded-lg bg-white/5" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <h3 className="text-white font-medium truncate text-sm">{product.name}</h3>
                                    <p className="text-white/40 text-xs line-clamp-2 mt-1">{product.description}</p>
                                    <div className="flex items-center justify-between mt-2">
                                      <span className="text-steam-blue font-semibold text-sm">${product.price}</span>
                                      {product.similarity && (
                                        <span className="text-[10px] text-white/20 px-1.5 py-0.5 rounded-full border border-white/5">
                                          {Math.round(product.similarity * 100)}% match
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {(() => {
                                  const shots = parseScreenshots(product.screenshots).slice(0, 3);
                                  return shots.length > 0 ? (
                                    <div className="flex gap-2 overflow-x-auto">
                                      {shots.map((url, si) => (
                                        <img
                                          key={si}
                                          src={url}
                                          alt={`${product.name} screenshot ${si + 1}`}
                                          className="h-20 w-auto flex-shrink-0 rounded-md object-cover bg-white/5"
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
              <motion.button
                onClick={handleSearch}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`h-9 w-9 flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer ${query.trim() ? "cta-frosted" : "bg-white/[0.06] text-white/20"}`}
              >
                <Send className="h-4 w-4" />
              </motion.button>
            </div>
          </motion.div>

          {/* Voice indicator (absolute positioning avoids layout shift) */}
          <AnimatePresence>
            {(voiceActive || isTranscribing) && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex items-center justify-center gap-3 pt-4 shrink-0">
                {isTranscribing ? (
                  <div className="flex items-center gap-2.5">
                    <div className="relative w-4 h-4">
                      <motion.span
                        className="absolute inset-0 rounded-full border border-steam-blue/25"
                        animate={{ scale: [1, 1.6], opacity: [0.4, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                      />
                      <motion.span
                        className="absolute inset-0 rounded-full border border-steam-blue/35"
                        animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
                        transition={{ duration: 1.5, delay: 0.5, repeat: Infinity, ease: "easeOut" }}
                      />
                      <span className="absolute inset-[4px] rounded-full bg-steam-blue/50" />
                    </div>
                    <span className="text-[12px] font-medium text-steam-blue/60 tracking-wide">Processing</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-end gap-0.5">
                      {[0.6, 1, 0.7, 1, 0.5].map((delay, i) => (
                        <motion.div
                          key={i}
                          className="w-0.5 bg-steam-blue/40 rounded-full"
                          animate={{ height: [3, 10, 3] }}
                          transition={{ duration: 0.9, delay: i * 0.08, repeat: Infinity, ease: "easeInOut" }}
                        />
                      ))}
                    </div>
                    <span className="text-[12px] font-medium text-steam-blue/60 tracking-wide">Listening</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

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
                <div className="flex items-center gap-2 mt-6">
                  <button onClick={() => scrollCategories(-1)} className="hidden sm:flex flex-shrink-0 h-8 w-8 items-center justify-center text-white/25 hover:text-white/50 transition-colors cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
                  <div ref={scrollRef} className="flex gap-2 overflow-x-auto scroll-smooth" style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
                    {SEARCH_CATEGORIES.map((cat) => (
                      <button key={cat.label} onClick={() => setQuery(cat.label + " games")} className={`flex-shrink-0 flex flex-col items-center gap-1.5 w-20 py-3 rounded-xl cursor-pointer group transition-all duration-200 ${glass} ${glassHover}`}>
                        <cat.icon className="h-5 w-5 text-white/25 group-hover:text-white/60 transition-colors" strokeWidth={1.5} />
                        <span className="text-[10px] font-medium text-white/35 group-hover:text-white/70 transition-colors">{cat.label}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => scrollCategories(1)} className="hidden sm:flex flex-shrink-0 h-8 w-8 items-center justify-center text-white/25 hover:text-white/50 transition-colors cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
                </div>

                <div className="mt-6 text-center pb-8">
                  <button onClick={() => setPromptSet((s) => s + 1)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/30 hover:text-white/50 mb-3 cursor-pointer group">
                    Try an example
                  </button>
                  <AnimatePresence mode="wait">
                    <motion.div key={promptSet} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="flex flex-wrap justify-center gap-2">
                      {prompts.map((prompt) => (
                        <button key={prompt} onClick={() => setQuery(prompt)} className={`text-[12px] font-medium text-white/45 hover:text-white/80 px-3.5 py-2 rounded-xl cursor-pointer transition-all duration-200 ${glass} ${glassHover}`}>{prompt}</button>
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
