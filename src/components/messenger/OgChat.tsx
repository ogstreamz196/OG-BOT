import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Send,
  Trash2,
  Skull,
  ShieldCheck,
  Paperclip,
  Mic,
  MicOff,
  Crown,
  X,
  Loader2,
  ArrowDown,
} from "lucide-react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { chatOgBot, type OgChatMessage } from "@/lib/og-messenger.functions";
import { ogErrorMessage } from "@/lib/og-error-message";
import { transcribeOgAudio } from "@/lib/og-transcribe.functions";
import { postCommunityMessage } from "@/lib/community.functions";
import { QUICK_STARTS } from "@/lib/og-persona-public";
import { routeOgMessage } from "@/lib/og-chat-routing";
import { toast } from "sonner";
import { TypingDots } from "@/components/ui/typing-dots";
import { useAuth } from "@/hooks/use-auth";
import { useDevMode } from "@/hooks/use-dev-mode";
import { useProfile } from "@/hooks/use-profile";
import { useRole } from "@/hooks/use-role";
import {
  useFoulMouth,
  useSetFoulMouth,
} from "@/hooks/use-foul-mouth";
// useShareLive intentionally removed — Loner/Community is page-level now.
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";

/** Telegram-style premium font stack — SF on Apple, Segoe on Windows, Roboto on Android. */
const TELEGRAM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", "Helvetica Neue", Helvetica, Roboto, Arial, sans-serif';
const TELEGRAM_FONT_STYLE: React.CSSProperties = {
  fontFamily: TELEGRAM_FONT_STACK,
  fontFeatureSettings: '"ss01", "cv11", "kern"',
  letterSpacing: "0",
  WebkitFontSmoothing: "antialiased",
  MozOsxFontSmoothing: "grayscale",
};
import ogBotAsset from "@/assets/ogbot.png.asset.json";

function OgAvatar({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={ogBotAsset.url}
      alt="OG Bot"
      width={size}
      height={size}
      className={cn(
        "rounded-full object-cover ring-0 border-0 outline-none select-none pointer-events-none",
        className,
      )}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

const STORAGE_KEY_PREFIX = "og-messenger-thread-v3:";
const SYNC_EVENT = "og-messenger:sync";
const MAX_PERSISTED = 60;
const LANG_KEY = "og-bot:language";
const OG_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "Portuguese",
  "Hindi",
  "Urdu",
  "Punjabi",
  "Arabic",
  "Swahili",
  "Patois",
  "Yoruba",
  "German",
  "Italian",
  "Romanian",
  "Filipino",
  "Tagalog",
  "Cebuano",
  "Mandarin",
  "Japanese",
  "Korean",
  "Turkish",
  "Russian",
  "Polish",
  "Dutch",
  "Greek",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Malay",
  "Bengali",
  "Tamil",
  "Hebrew",
  "Lithuanian",
];

function storageKey(userId: string | null | undefined) {
  return `${STORAGE_KEY_PREFIX}${userId ?? "anon"}`;
}

function loadThread(userId: string | null | undefined): OgChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is OgChatMessage =>
        m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
  } catch {
    return [];
  }
}

interface OgChatProps {
  /** Compact variant for the floating widget (no outer card chrome). */
  compact?: boolean;
  /** Show the header strip with toggles + clear. */
  showHeader?: boolean;
  /** Show quick-start chips on empty state. */
  showQuickStarts?: boolean;
  /** Optional seeded text to drop in the input (e.g. when opened via "With OG"). */
  seed?: string | null;
}

/**
 * Shared OG Bot chat surface. Used by both /messenger and the floating
 * widget. Same backend, same memory, same toggles — synced cross-surface
 * via localStorage + CustomEvent.
 */
export function OgChat({
  compact = false,
  showHeader = false,
  showQuickStarts = true,
  seed = null,
}: OgChatProps) {
  const { user } = useAuth();
  const dev = useDevMode();
  const userId = user?.id ?? null;
  const [messages, setMessages] = useState<OgChatMessage[]>(() => loadThread(userId));
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selfSyncRef = useRef(false);
  const chat = useServerFn(chatOgBot);
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const { foulMouth } = useFoulMouth();
  const setFoulMouth = useSetFoulMouth();

  const { isVip } = useRole();
  // shareLive removed: Loner Mode is enforced by the page mounting OgChat.
  const postCommunity = useServerFn(postCommunityMessage);
  const transcribe = useServerFn(transcribeOgAudio);
  // Private/incognito browsers can block or throw on storage — the chosen
  // language must still work for the session, so storage is best-effort only.
  const [language, setLanguage] = useState<string>("English");
  const langLoaded = useRef(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved && OG_LANGUAGES.includes(saved as (typeof OG_LANGUAGES)[number]))
        setLanguage(saved);
    } catch {
      /* storage blocked in private mode */
    }
    langLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!langLoaded.current) return;
    try {
      window.localStorage.setItem(LANG_KEY, language);
    } catch {
      /* storage blocked in private mode — keep in-memory choice */
    }
  }, [language]);

  // Attachment + mic state
  const [attachment, setAttachment] = useState<{ dataUrl: string; name: string } | null>(null);
  const [vipPromoOpen, setVipPromoOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

  useLayoutEffect(() => {
    const composer = inputRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 40), 128)}px`;
  }, [input]);

  // Anti-flicker skeleton: stays visible at least 600ms once shown so quick
  // replies don't pop in and out (matches Suno-style "cooking" feel).
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    setMessages(loadThread(userId));
  }, [userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-MAX_PERSISTED)));
  }, [messages, userId]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey(userId) || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) setMessages(parsed);
      } catch {
        /* ignore */
      }
    }
    function onLocal() {
      if (selfSyncRef.current) {
        selfSyncRef.current = false;
        return;
      }
      setMessages(loadThread(userId));
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SYNC_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SYNC_EVENT, onLocal);
    };
  }, [userId]);

  // Realtime: receive bot messages injected by dev (dev_send_og_message_as_bot).
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`og-messages-inbox:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "og_messages",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresInsertPayload<{ role: string; content: string }>) => {
          const row = payload.new;
          if (row.role !== "assistant") return;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.content === row.content) {
              return prev;
            }
            return [...prev, { role: "assistant", content: row.content }];
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // Smart auto-scroll: only stick to bottom when the user is already near it,
  // so reading older messages isn't interrupted by new replies streaming in.
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  const [jumpAnnounce, setJumpAnnounce] = useState("");

  function scrollToBottom(behavior: ScrollBehavior = "smooth", quiet = false) {
    const el = scrollRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Never animate while the user is typing — instant snap keeps taps responsive.
    const typing = document.activeElement === inputRef.current;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce || typing ? "auto" : behavior });
    setAtBottom(true);
    setHasNew(false);
    if (quiet) return;
    // Announce arrival + hand focus to composer so screen readers regain
    // context and keyboard users can immediately reply.
    setJumpAnnounce("Jumped to latest message");
    window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      setJumpAnnounce("");
    }, 350);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      const target = scrollRef.current;
      if (!target) return;
      const distance = target.scrollHeight - target.scrollTop - target.clientHeight;
      const near = distance < 80;
      setAtBottom(near);
      if (near) setHasNew(false);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (atBottom) {
      scrollToBottom("smooth");
    } else {
      setHasNew(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // NOTE: no programmatic focus on mount. Mobile browsers refuse to open the
  // keyboard for a focus() the user didn't trigger, but still mark the field as
  // the active element — so the user's first real tap is swallowed as a no-op.

  // Apply seeded prompt (e.g. from "With OG" CTA on /library).
  useEffect(() => {
    if (seed && seed.trim()) {
      setInput((prev) => (prev.trim() ? prev : seed));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [seed]);

  // Re-scroll while skeleton is mounted so it stays in view if user was at bottom.
  useEffect(() => {
    if (showSkeleton && atBottom) {
      scrollToBottom("smooth");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSkeleton]);

  const m = useMutation({
    mutationFn: async (args: { history: OgChatMessage[]; attachmentDataUrl?: string }) =>
      chat({
        data: {
          messages: args.history,
          mode,
          attachmentDataUrl: args.attachmentDataUrl,
          language,
        },
      }),
    onSuccess: (res) => {
      setMessages((cur) => {
        const next = [...cur, { role: "assistant" as const, content: res.reply || "…" }];
        selfSyncRef.current = true;
        window.dispatchEvent(new Event(SYNC_EVENT));
        return next;
      });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    onError: (err: Error) => {
      setMessages((cur) => [...cur, { role: "assistant", content: ogErrorMessage(err) }]);
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  // Skeleton stays visible at least 600ms once shown — kills flicker on
  // very fast replies and gives a Suno-style "still cooking" feel.
  useEffect(() => {
    if (m.isPending) {
      setShowSkeleton(true);
      return;
    }
    if (!showSkeleton) return;
    const t = setTimeout(() => setShowSkeleton(false), 600);
    return () => clearTimeout(t);
  }, [m.isPending, showSkeleton]);


  function sendText(text: string, opts?: { forcePrivate?: boolean }) {
    const t = text.trim();
    const att = attachment;
    if (m.isPending) return;
    if (!user) return toast.error("Sign in to chat with OG Bot.");

    // OG Bot Loner Mode is ALWAYS private. The page-level Loner ↔ Community
    // toggle (in /messenger) is the single source of truth — when OgChat is
    // mounted, the user has chosen Loner Mode, so we ignore the legacy
    // shareLive preference here. Community posting happens in CommunityRoom.
    const target = routeOgMessage({
      text: t,
      hasAttachment: !!att,
      shareLive: false,
      forcePrivate: true,
    });

    if (target === "noop") return;

    if (target === "community") {
      // Defensive: should be unreachable now that shareLive is forced off.
      setInput("");
      setAttachment(null);
      postCommunity({ data: { content: t } })
        .then(() => {
          toast.success("Posted to the OG Battle Zone", {
            action: {
              label: "Open",
              onClick: () => {
                window.location.href = "/messenger?live=1";
              },
            },
          });
        })
        .catch((e: Error) => toast.error(e.message));
      return;
    }

    // private — free, no coin check. Images are read and discussed, never edited.
    const visibleText = t || (att ? `📎 ${att.name}` : "");
    const next = [...messages, { role: "user" as const, content: visibleText }];
    setMessages(next);
    selfSyncRef.current = true;
    window.dispatchEvent(new Event(SYNC_EVENT));
    setInput("");
    setAttachment(null);
    m.mutate({ history: next, attachmentDataUrl: att?.dataUrl });
  }

  function clearChat() {
    setMessages([]);
    selfSyncRef.current = true;
    window.dispatchEvent(new Event(SYNC_EVENT));
    toast.message("Chat cleared");
  }

  async function toggleFoul() {
    if (!isVip) {
      setVipPromoOpen(true);
      return;
    }
    try {
      const next = !foulMouth;
      await setFoulMouth.mutateAsync(next);
      // Toast confirmation is fired centrally by useSetFoulMouth's onSuccess
      // so every surface (messenger, settings, library) shows the same message.
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleFile(file: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return toast.error("Only images are supported right now.");
    }
    if (file.size > 5 * 1024 * 1024) {
      return toast.error("Image too large (max 5MB).");
    }
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read file"));
      r.readAsDataURL(file);
    });
    setAttachment({ dataUrl, name: file.name });
  }

  async function startRecording() {
    if (recording || transcribing) return;
    if (!user) return toast.error("Sign in to use voice.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordChunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && recordChunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || "audio/webm" });
        recordChunksRef.current = [];
        if (blob.size < 1024) {
          toast.error("That clip was empty — try again.");
          return;
        }
        setTranscribing(true);
        try {
          const buf = await blob.arrayBuffer();
          // Browser-safe base64 encode
          let binary = "";
          const bytes = new Uint8Array(buf);
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
          }
          const audioBase64 = btoa(binary);
          const res = await transcribe({ data: { audioBase64, mime: blob.type } });
          const text = res.text?.trim();
          if (text) {
            setInput((cur) => (cur ? `${cur} ${text}` : text));
            setTimeout(() => inputRef.current?.focus(), 0);
          } else {
            toast.message("Didn't catch that — try again.");
          }
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      toast.error("Microphone access denied.");
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  const balance = profile?.coin_balance ?? 0;
  const isOut = false;
  const foulActive = foulMouth;
  const mode = foulMouth ? "og" : "safe";

  return (
    <div
      style={TELEGRAM_FONT_STYLE}
      className={cn(
        "flex h-full flex-col text-[13px] antialiased sm:text-sm",
        compact ? "" : "rounded-xl border border-border bg-card",
      )}
    >
      <VipFoulPromo open={vipPromoOpen} onOpenChange={setVipPromoOpen} />
      {showHeader && (
        <div
          data-testid="ogchat-header"
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 border-b border-border/60 bg-muted/20 px-2 py-1.5 sm:flex sm:px-3 sm:py-2"
        >
          {/* Foul-mouth hero toggle — the main highlight */}
          <button
            type="button"
            onClick={toggleFoul}
            disabled={setFoulMouth.isPending}
            aria-pressed={foulActive}
            aria-label="Toggle foul mouth"
            data-testid="ogchat-foulmouth-hero"
            className={cn(
              "group relative flex min-w-0 items-center justify-between gap-1.5 overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 sm:w-full sm:flex-1 sm:px-3 sm:py-1.5",
              foulActive
                ? "border-destructive bg-gradient-to-br from-destructive/25 via-destructive/15 to-destructive/10 shadow-[0_6px_24px_-8px_hsl(var(--destructive)/0.6)] hover:shadow-[0_8px_28px_-6px_hsl(var(--destructive)/0.7)]"
                : "border-border bg-card hover:border-destructive/60 hover:bg-destructive/5",
            )}
          >
            <span className="flex min-w-0 items-center gap-2 sm:gap-3">
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-md text-sm transition-transform group-hover:scale-105 sm:h-8 sm:w-8 sm:text-base",
                  foulActive
                    ? "bg-destructive text-destructive-foreground shadow-[0_0_18px_-2px_hsl(var(--destructive)/0.8)]"
                    : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {foulActive ? "🤬" : <Skull className="h-5 w-5" />}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span
                  className={cn(
                    "truncate text-[10px] font-bold uppercase sm:text-xs",
                    foulActive ? "text-destructive" : "text-foreground",
                  )}
                >
                  {foulActive ? "Foul mouth on" : "Foul mouth off"}
                </span>
              </span>
            </span>
            {/* Big visual switch */}
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full border transition-colors sm:h-6 sm:w-10",
                foulActive ? "border-destructive bg-destructive" : "border-border bg-muted",
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-background shadow-md transition-all sm:h-4 sm:w-4",
                  foulActive ? "left-[calc(100%-1rem)] sm:left-[calc(100%-1.15rem)]" : "left-0.5",
                )}
              />
            </span>
          </button>

          {/* Secondary controls row */}
          <div
            data-testid="ogchat-controls"
            className="flex shrink-0 items-center justify-end gap-1 text-xs sm:w-[180px] sm:shrink-0 sm:flex-col sm:items-stretch sm:justify-center"
          >
            <span className="hidden items-center gap-1.5 text-muted-foreground sm:mr-auto sm:inline-flex">
              <OgAvatar size={18} />
              <span className="font-semibold">
                {balance} coin{balance === 1 ? "" : "s"}
              </span>
            </span>
            {/* OG/Safe mode toggle removed — Foul Mouth is the single tone control. */}
            <label className="relative inline-flex h-8 items-center rounded-lg border border-amber-400/50 bg-amber-400/10 px-2 text-[10px] font-bold text-amber-600 dark:text-amber-300 sm:hidden">
              🌐 {language.slice(0, 2).toUpperCase()}
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="absolute inset-0 opacity-0"
                aria-label="Reply language"
              >
                {OG_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="hidden h-8 max-w-[88px] rounded-lg border border-amber-400/50 bg-amber-400/10 px-1.5 text-[10px] font-bold text-amber-600 transition hover:bg-amber-400/20 focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:text-amber-300 sm:block sm:h-auto sm:max-w-none sm:border-2 sm:px-3 sm:py-1.5 sm:text-[12px]"
              title="Reply language"
              aria-label="Reply language"
            >
              {OG_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  🌐 {l}
                </option>
              ))}
            </select>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearChat}
                className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-muted text-muted-foreground transition hover:bg-muted/80 sm:inline-flex sm:w-auto sm:gap-1 sm:border-2 sm:px-2.5 sm:py-1.5 sm:text-[12px] sm:font-semibold"
                title="Clear chat history"
              >
                <Trash2 className="h-3.5 w-3.5" />{" "}
                <span className="sr-only sm:not-sr-only">Clear</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2 pb-2 pt-2 scroll-smooth [-webkit-overflow-scrolling:touch] sm:space-y-2.5 sm:px-3 sm:pb-4 sm:pt-3"
          style={{ touchAction: "pan-y" }}
        >
          {messages.length === 0 && (
            <div className="grid h-full place-items-center text-center">
              <div className="w-full max-w-md space-y-2 sm:space-y-4">
                <div className="relative mx-auto h-20 w-20 sm:h-32 sm:w-32">
                  <div className="absolute inset-0 rounded-full bg-primary/40 blur-[60px] animate-pulse" />
                  <div
                    aria-hidden="true"
                    className="absolute -inset-6 -z-10 opacity-80"
                    style={{
                      background:
                        "radial-gradient(45% 50% at 30% 30%, rgba(239,68,68,0.45), transparent 70%), radial-gradient(50% 55% at 70% 70%, rgba(59,130,246,0.55), transparent 70%)",
                      filter: "blur(28px)",
                    }}
                  />
                  <img
                    src={ogBotAsset.url}
                    alt="OG Bot"
                    className="relative h-full w-full rounded-full object-cover ring-4 ring-primary/40 shadow-[0_0_60px_-10px_hsl(var(--primary)/0.9)] animate-[bob_3s_ease-in-out_infinite]"
                  />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-extrabold sm:text-2xl">
                    Message <span className="text-gradient-brand">OG Bot</span>
                  </h2>
                  <p className="text-xs text-muted-foreground sm:text-base">
                    Ask anything. Private chat is free.
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                    {balance} coins left
                  </p>
                </div>
                {showQuickStarts && (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <div
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary"
                      title="Private chat — only you and OG Bot can see this"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      Private · OG Bot Loner Mode
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {QUICK_STARTS.map((q) => (
                        <button
                          key={q.label}
                          type="button"
                          data-testid="og-quickstart-chip"
                          data-target="private"
                          onClick={() => sendText(q.prompt, { forcePrivate: true })}
                          disabled={m.isPending || isOut || !user}
                          className="rounded-full border-2 border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-bold text-foreground transition hover:-translate-y-0.5 hover:rotate-[-1deg] hover:border-primary hover:bg-primary/20 active:translate-y-0 disabled:opacity-40"
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {messages.map((msg, i) => {
            const isUser = msg.role === "user";
            const initial = dev.isDev
              ? "D"
              : (profile?.display_name || user?.email || "Y").trim().charAt(0).toUpperCase();
            return (
              <div
                key={i}
                className={cn(
                  "flex items-end gap-1.5 motion-safe:animate-[pop_0.2s_ease-out] sm:gap-2",
                  isUser ? "flex-row-reverse" : "flex-row",
                )}
              >
                {isUser ? (
                  <div
                    className={cn(
                      "relative grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-brand text-[10px] font-black text-primary-foreground shadow-glow sm:h-8 sm:w-8",
                      isVip &&
                        "ring-2 ring-amber-300 ring-offset-2 ring-offset-background shadow-[0_0_18px_rgba(251,191,36,0.55)]",
                    )}
                  >
                    {initial}
                    {isVip && (
                      <Crown
                        className="absolute -top-2 -right-1 h-4 w-4 rotate-[18deg] fill-amber-300 text-amber-500 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
                        aria-label="VIP"
                      />
                    )}
                  </div>
                ) : (
                  <OgAvatar size={28} className="shrink-0 sm:h-8 sm:w-8" />
                )}
                <Message
                  from={msg.role}
                  className={cn(
                    "min-w-0 flex-1 max-w-[calc(100%-2rem)] gap-0.5 sm:max-w-[82%] lg:max-w-[74%]",
                    isUser ? "items-end" : "items-start",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-1.5 text-[8px] font-bold uppercase",
                      isUser ? (isVip ? "text-amber-400" : "text-primary") : "text-foreground/70",
                    )}
                  >
                    {isUser ? "You" : "OG Bot"}
                    {isUser && isVip && (
                      <>
                        <Crown className="h-3 w-3 fill-amber-300 text-amber-500" />
                        <span className="text-amber-400">VIP</span>
                      </>
                    )}
                  </span>
                  <MessageContent
                    className={cn(
                      "break-words text-[13px] leading-[1.38] sm:text-sm",
                      isUser
                        ? isVip
                          ? "rounded-2xl rounded-br-sm whitespace-pre-wrap px-3 py-2 font-medium text-amber-50 bg-gradient-to-br from-amber-500 via-amber-600 to-yellow-700 ring-1 ring-amber-300/60"
                          : "rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground whitespace-pre-wrap font-medium"
                        : "w-full bg-transparent p-0 text-foreground shadow-none",
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <MessageResponse className="prose-sm max-w-none prose-p:my-0.5 prose-p:leading-snug prose-ul:my-0.5 prose-ol:my-0.5 prose-headings:my-0.5 prose-code:text-primary">
                        {msg.content}
                      </MessageResponse>
                    ) : (
                      msg.content
                    )}
                  </MessageContent>
                </Message>
              </div>
            );
          })}
          {(showSkeleton || m.isPending) && (
            <div
              className="flex items-end gap-3"
              role="status"
              aria-live="polite"
              aria-label="OG Bot is typing"
            >
              <OgAvatar size={40} className="shrink-0 animate-pulse" />
              <div className="flex flex-col gap-1.5 min-w-[60%] max-w-[78%]">
                <span className="px-2 text-[10px] font-black uppercase tracking-[0.18em] text-foreground/70 inline-flex items-center gap-1.5">
                  OG Bot
                  <span className="font-bold normal-case tracking-normal text-muted-foreground/80">
                    is typing<span className="inline-block animate-pulse">…</span>
                  </span>
                </span>
                <div className="rounded-2xl rounded-bl-sm bg-card border-2 border-border px-4 py-3 inline-flex items-center">
                  <TypingDots aria-label="OG Bot is typing" />
                </div>
                {/* Shimmering bubble skeletons — Suno-style "still cooking" placeholders */}
                <div className="space-y-1.5">
                  <div className="h-3 w-[85%] rounded-md bg-gradient-to-r from-muted via-muted/40 to-muted bg-[length:200%_100%] animate-[shimmer_1.6s_linear_infinite]" />
                  <div className="h-3 w-[70%] rounded-md bg-gradient-to-r from-muted via-muted/40 to-muted bg-[length:200%_100%] animate-[shimmer_1.6s_linear_infinite]" />
                  <div className="h-3 w-[55%] rounded-md bg-gradient-to-r from-muted via-muted/40 to-muted bg-[length:200%_100%] animate-[shimmer_1.6s_linear_infinite]" />
                </div>
                <span className="sr-only">OG Bot is generating a response</span>
              </div>
            </div>
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            aria-label="Jump to latest message"
            className={cn(
              "absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-primary/40 bg-background/90 px-3.5 py-1.5 text-xs font-bold text-foreground shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.6)] backdrop-blur-md transition hover:scale-105 active:scale-95",
              hasNew &&
                "border-primary bg-primary text-primary-foreground shadow-glow animate-[pop_0.25s_ease-out]",
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {hasNew ? "New messages" : "Jump to latest"}
          </button>
        )}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {jumpAnnounce}
        </div>
      </div>

      {isOut && user && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive sm:px-4">
          <span className="min-w-0 break-words font-semibold">
            You're out of OG coins. Don't sweat — your balance resets to 5 tomorrow.
          </span>
          <Link
            to="/buy-coins"
            className="shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 font-bold uppercase tracking-wide hover:bg-destructive/20"
          >
            Top up
          </Link>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendText(input);
        }}
        style={{ touchAction: "manipulation" }}
        className="sticky bottom-0 z-40 border-t border-border/80 bg-card/95 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/75 sm:px-3 sm:py-2"
      >
        {attachment && (
          <div className="mb-2 rounded-xl border border-border bg-muted/40 p-2">
            <div className="flex items-center gap-2">
              <img src={attachment.dataUrl} alt="" className="h-10 w-10 rounded-md object-cover" />
              <span className="flex-1 truncate text-xs text-muted-foreground">
                {attachment.name} · ask OG Bot anything about it
              </span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Remove attachment"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        {/* Unified composer pill — attachment | mic | textarea | send (Telegram/WhatsApp pattern) */}
        <div
          className={cn(
            "flex items-end gap-0.5 rounded-xl border border-primary/40 bg-background/80 px-1 py-1 ring-1 ring-primary/20 backdrop-blur-xl transition focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/30 sm:rounded-2xl sm:px-2 sm:py-1.5",
            (isOut || !user) && "opacity-70",
          )}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!user || m.isPending}
            aria-label="Attach image"
            title="Attach image"
            className="mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={!user || m.isPending || transcribing}
            aria-label={recording ? "Stop recording" : "Voice input"}
            aria-pressed={recording}
            title={recording ? "Stop recording" : "Voice input"}
            className={cn(
              "mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40",
              recording
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            {transcribing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : recording ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText(input);
              }
            }}
            rows={2}
            placeholder={
              transcribing
                ? "Transcribing…"
                : recording
                  ? "Listening… tap mic to stop"
                  : isOut
                    ? "Out of coins — top up to chat"
                    : attachment
                      ? "Ask about this image…"
                      : "Message OG Bot…"
            }
            disabled={m.isPending || isOut || !user || transcribing}
            maxLength={2000}
            inputMode="text"
            enterKeyHint="send"
            aria-label="Message OG Bot in Loner Mode"
            data-testid="og-loner-composer"
            style={{ touchAction: "manipulation" }}
            className="min-h-10 max-h-32 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2.5 text-base leading-5 placeholder:text-muted-foreground/70 focus:outline-none disabled:cursor-not-allowed sm:px-2.5 sm:text-[15px]"
          />
          <button
            type="submit"
            disabled={m.isPending || (!input.trim() && !attachment) || isOut || !user}
            aria-label="Send message"
            title="Send"
            data-testid="og-loner-send"
            className="mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-[0_8px_22px_-6px_hsl(var(--primary)/0.6)] ring-1 ring-primary/40 transition hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:ring-0"
          >
            {m.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
        <p
          className="mt-1 flex items-center justify-between gap-2 px-1 text-[10px] font-medium text-muted-foreground/80 sm:mt-2.5 sm:flex-wrap sm:justify-start sm:px-2 sm:text-xs"
          aria-live="polite"
        >
          {m.isPending ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground/90">
              <Loader2 className="h-3 w-3 animate-spin" /> Sending…
            </span>
          ) : (
            <span className="hidden sm:inline">Enter to send · Shift+Enter for newline</span>
          )}
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <span>
            <span className="font-bold text-foreground/90">{balance}</span> coin
            {balance === 1 ? "" : "s"} left
          </span>
        </p>
      </form>
    </div>
  );
}

function VipFoulPromo({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unlock Foul Mouth with OG VIP"
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl border-2 border-destructive/50 bg-card p-5 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl" aria-hidden>
          🤬
        </div>
        <h3 className="mt-2 font-display text-lg font-black">Unlock Foul Mouth</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          OG Bot goes unfiltered — savage roasts, UK street slang, no holding back.
        </p>
        <ul className="mt-3 space-y-1 text-left text-xs text-foreground/90">
          <li>🔥 Unfiltered OG Bot persona</li>
          <li>👑 Your own OG VIP ID and gold badge</li>
          <li>⚡ Priority replies + daily 10-coin safety net</li>
        </ul>
        <div className="mt-4 grid gap-2">
          <a
            href="/buy-coins?flow=vip"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-brand font-bold text-primary-foreground"
          >
            Get OG VIP · from £4.99
          </a>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 text-xs font-semibold text-muted-foreground"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
