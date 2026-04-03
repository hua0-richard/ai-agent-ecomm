import { useState, useRef, useEffect } from "react";
import { Swords, Gamepad2, Users, Sparkles, TrendingUp, Zap, Search, ChevronLeft, ChevronRight, Plus, Mic, Image, RefreshCw, Send } from "lucide-react";
import { useClip } from "./hooks/useClip";
import { motion, AnimatePresence } from "framer-motion";

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

function App() {
  const [query, setQuery] = useState("");
  const [promptSet, setPromptSet] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clipStatus = useClip();
  const [clipPulse, setClipPulse] = useState(true);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [glowVisible, setGlowVisible] = useState(false);
  useEffect(() => {
    if (clipStatus !== "loading") return;
    const t = setInterval(() => setClipPulse((p) => !p), 1400);
    return () => clearInterval(t);
  }, [clipStatus]);

  const prompts = EXAMPLE_PROMPTS[promptSet % EXAMPLE_PROMPTS.length];

  function scrollCategories(dir: number) {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setQuery(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center selection:bg-steam-blue/20 selection:text-white overflow-x-hidden"
      onMouseMove={(e) => {
        setMousePos({ x: e.clientX, y: e.clientY });
        const target = e.target as HTMLElement;
        const overInteractive = !!target.closest(".glass, textarea, button, a, input");
        setGlowVisible(!overInteractive);
      }}
    >
      {/* Mouse glow */}
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
      {/* Dot grid — rendered as a real element so backdrop-filter can blur it */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 85% 85% at 50% 50%, black 35%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 85% 85% at 50% 50%, black 35%, transparent 100%)",
        }}
      />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[800px] h-[500px] bg-[radial-gradient(ellipse_at_center,rgba(26,159,255,0.06)_0%,transparent_70%)] pointer-events-none" />

      <div className="max-w-[680px] w-full mx-auto px-4 sm:px-6 py-8 relative">
        {/* Logo & Headline */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="text-center mb-10"
        >
          {/* Steam logo + Agent text */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <svg className="w-12 h-12 text-white/80" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
            </svg>
            <span className="relative text-white/80 text-[2rem] font-semibold tracking-[0.05em] uppercase">
              AGENT
              <span className="absolute -top-0.5 -right-3 h-2 w-2 rounded-full bg-[#6abf47]/70 animate-[pulse_3s_ease-in-out_infinite] shadow-[0_0_8px_2px_rgba(106,191,71,0.4)]" />
            </span>
          </div>

          <h1 className="text-[clamp(1.75rem,4vw,2.75rem)] font-semibold text-white tracking-[-0.03em] leading-[1.12] mb-3">
            Like having a friend who's played everything on Steam.
          </h1>
          <p className="text-white/40 text-[15px] max-w-sm mx-auto leading-relaxed">
            Ask anything. Get genuine recommendations.
          </p>
        </motion.div>

        {/* Search container */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease }}
          className={`rounded-2xl ${glass} transition-[box-shadow,border-color] duration-300 focus-within:border-[rgba(160,210,255,0.22)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(255,255,255,0.03),0_0_48px_rgba(26,159,255,0.07),0_0_120px_rgba(26,159,255,0.04),0_4px_24px_rgba(0,0,0,0.3)]`}
        >
          <div className="px-4 pt-4 pb-2">
            <textarea
              ref={textareaRef}
              value={query}
              onChange={handleTextareaInput}
              placeholder="Describe your ideal game, Agent will find it..."
              rows={1}
              className="w-full bg-transparent text-[15px] font-medium text-white/90 placeholder:text-white/25 resize-none outline-none leading-relaxed"
              style={{ minHeight: "28px" }}
            />
          </div>

          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              <button className="h-8 w-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all duration-200 cursor-pointer">
                <Plus className="h-4 w-4" />
              </button>
              <button
                disabled={clipStatus !== "ready"}
                title={clipStatus === "loading" ? "Visual search is warming up…" : clipStatus === "error" ? "Visual search unavailable" : undefined}
                className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors duration-200 ${
                  clipStatus === "ready"
                    ? "text-white/30 hover:text-white/60 hover:bg-white/[0.06] cursor-pointer"
                    : "cursor-not-allowed"
                }`}
              >
                <Image
                  className="h-4 w-4"
                  style={{
                    opacity: clipStatus === "loading" ? (clipPulse ? 0.2 : 0.6) : undefined,
                    transition: "opacity 0.6s ease-in-out",
                  }}
                />
              </button>
              <button
                onClick={() => setVoiceActive(!voiceActive)}
                className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer ${
                  voiceActive
                    ? "text-steam-blue bg-steam-blue/10"
                    : "text-white/30 hover:text-white/60 hover:bg-white/[0.06]"
                }`}
              >
                <Mic className="h-4 w-4" />
              </button>
            </div>

            <motion.button
              whileHover={{ scale: 1.1, x: 1, y: -1 }}
              whileTap={{ scale: 0.93, x: 0, y: 0 }}
              transition={{ type: "spring", stiffness: 700, damping: 20 }}
              className={`h-9 w-9 flex items-center justify-center rounded-xl transition-[background,border,box-shadow] duration-300 cursor-pointer ${
                query.trim()
                  ? "cta-frosted"
                  : "bg-white/[0.06] text-white/20"
              }`}
            >
              <Send className="h-4 w-4" />
            </motion.button>
          </div>
        </motion.div>

        {/* CLIP status */}
        <AnimatePresence>
          {clipStatus === "loading" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease }}
              className="flex items-center justify-center gap-2 pt-3"
            >
              <motion.span
                className="inline-block w-1 h-1 rounded-full bg-white/20"
                animate={{ opacity: [0.2, 0.6, 0.2] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
              <span className="text-[11px] text-white/25 tracking-wide">Warming up visual search</span>
              <motion.span
                className="inline-block w-1 h-1 rounded-full bg-white/20"
                animate={{ opacity: [0.2, 0.6, 0.2] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Voice indicator */}
        <AnimatePresence>
          {voiceActive && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-center gap-3 pt-4">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-1 bg-steam-blue rounded-full"
                      animate={{ height: [4, 16, 4] }}
                      transition={{ duration: 0.8, delay: i * 0.1, repeat: Infinity, ease: "easeInOut" }}
                    />
                  ))}
                </div>
                <span className="text-[12px] font-medium text-steam-blue/70">Listening...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Category pills */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease }}
          className="flex items-center gap-2 mt-6"
        >
          <button
            onClick={() => scrollCategories(-1)}
            className="hidden sm:flex flex-shrink-0 h-8 w-8 items-center justify-center text-white/25 hover:text-white/50 transition-colors duration-200 cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div
            ref={scrollRef}
            className="flex gap-2 overflow-x-auto scroll-smooth"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            {SEARCH_CATEGORIES.map((cat) => (
              <button
                key={cat.label}
                onClick={() => setQuery(cat.label + " games")}
                className={`flex-shrink-0 flex flex-col items-center gap-1.5 w-20 py-3 rounded-xl cursor-pointer group transition-all duration-200 ${glass} ${glassHover}`}
              >
                <cat.icon className="h-5 w-5 text-white/25 group-hover:text-white/60 transition-colors duration-200" strokeWidth={1.5} />
                <span className="text-[10px] font-medium text-white/35 group-hover:text-white/70 transition-colors duration-200">
                  {cat.label}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => scrollCategories(1)}
            className="hidden sm:flex flex-shrink-0 h-8 w-8 items-center justify-center text-white/25 hover:text-white/50 transition-colors duration-200 cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </motion.div>

        {/* Example prompts */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3, ease }}
          className="mt-6 text-center"
        >
          <button
            onClick={() => setPromptSet((s) => s + 1)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/30 hover:text-white/50 transition-colors duration-200 mb-3 cursor-pointer group"
          >
            Try an example
            <RefreshCw className="h-3 w-3 group-hover:rotate-180 transition-transform duration-500" />
          </button>
          <AnimatePresence mode="wait">
            <motion.div
              key={promptSet}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease }}
              className="flex flex-wrap justify-center gap-2"
            >
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setQuery(prompt)}
                  className={`text-[12px] font-medium text-white/45 hover:text-white/80 px-3.5 py-2 rounded-xl cursor-pointer transition-all duration-200 ${glass} ${glassHover}`}
                >
                  {prompt}
                </button>
              ))}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

export default App;
