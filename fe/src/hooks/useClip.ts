import { useEffect, useState } from "react";

export type ClipStatus = "loading" | "ready" | "error";

export function useClip() {
  const [status, setStatus] = useState<ClipStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { pipeline } = await import("@xenova/transformers");
        const minDelay = new Promise((r) => setTimeout(r, 2500));
        await Promise.all([
          pipeline("feature-extraction", "Xenova/clip-vit-base-patch32"),
          minDelay,
        ]);
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
