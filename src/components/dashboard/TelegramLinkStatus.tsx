import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, MessageCircle, AlertCircle, Loader2, XCircle, Send } from "lucide-react";
import { getMyTelegramStatus, getMyTelegramLinkToken } from "@/lib/telegram-admin.functions";

const TELEGRAM_BOT_USERNAME = "OGStreamzBot";

function formatLinkedAt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

type Tone = {
  border: string;
  bg: string;
  iconBg: string;
  iconText: string;
  pill: string;
};

const TONES: Record<"verified" | "failed" | "pending" | "unlinked", Tone> = {
  verified: {
    border: "border-emerald-400/40",
    bg: "bg-emerald-500/10",
    iconBg: "bg-emerald-500/20",
    iconText: "text-emerald-300",
    pill: "bg-emerald-500/20 text-emerald-300",
  },
  failed: {
    border: "border-red-400/40",
    bg: "bg-red-500/10",
    iconBg: "bg-red-500/20",
    iconText: "text-red-300",
    pill: "bg-red-500/20 text-red-300",
  },
  pending: {
    border: "border-amber-400/40",
    bg: "bg-amber-500/10",
    iconBg: "bg-amber-500/20",
    iconText: "text-amber-300",
    pill: "bg-amber-500/20 text-amber-300",
  },
  unlinked: {
    border: "border-amber-400/40",
    bg: "bg-amber-500/10",
    iconBg: "bg-amber-500/20",
    iconText: "text-amber-300",
    pill: "bg-amber-500/20 text-amber-300",
  },
};

export function TelegramLinkStatus() {
  const statusFn = useServerFn(getMyTelegramStatus);
  const tokenFn = useServerFn(getMyTelegramLinkToken);
  const qc = useQueryClient();
  const [reconnecting, setReconnecting] = useState(false);
  const launchedAt = useRef<number | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["my-telegram-status"],
    queryFn: () => statusFn(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const state = data?.state ?? "unlinked";
  const canReconnect = state !== "verified";

  // When the user returns from Telegram, re-check and nudge if still not verified.
  useEffect(() => {
    function onFocus() {
      if (!launchedAt.current) return;
      if (Date.now() - launchedAt.current < 1500) return;
      qc.invalidateQueries({ queryKey: ["my-telegram-status"] }).then(() => {
        const fresh = qc.getQueryData<{ state?: string }>(["my-telegram-status"]);
        if (fresh?.state !== "verified") {
          toast.error("Telegram didn't confirm yet", {
            description:
              "Open OG Bot and tap Start, then allow ALL permissions — message access is required so we can verify and message you. Tap Reconnect to try again.",
            duration: 8000,
          });
        } else {
          toast.success("Telegram connected");
        }
        launchedAt.current = null;
      });
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  async function handleReconnect(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (reconnecting) return;
    setReconnecting(true);
    try {
      const { token } = await tokenFn();
      if (!token) throw new Error("No token");
      toast.message("Opening Telegram…", {
        description: "Tap Start and allow ALL permissions so OG Bot can message you.",
      });
      launchedAt.current = Date.now();
      const url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error("Couldn't generate start link", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setReconnecting(false);
    }
  }

  if (isLoading || !data) {
    return (
      <section
        data-testid="telegram-status-card"
        aria-label="Telegram connection status"
        aria-busy="true"
        style={{ minHeight: "clamp(5rem, 14vw, 6.5rem)" }}
        className="flex items-center gap-3 rounded-2xl border-2 border-border/40 bg-muted/20 px-4 py-3 backdrop-blur-md"
      >
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Checking Telegram link…
        </span>
      </section>
    );
  }

  const tone = TONES[state];

  const label =
    state === "verified"
      ? "Verified"
      : state === "failed"
        ? "Verification failed"
        : state === "pending"
          ? "Pending verification"
          : "Not linked";

  const headline =
    state === "verified"
      ? "Telegram linked"
      : state === "failed"
        ? "Telegram link broken"
        : state === "pending"
          ? "Telegram pending"
          : "Telegram not linked";

  const detail =
    state === "verified"
      ? `Connected${data.username ? ` as @${data.username}` : ""}${
          data.linkedAt ? ` · since ${formatLinkedAt(data.linkedAt)}` : ""
        }`
      : state === "failed"
        ? `OG Bot couldn't reach your chat${data.verifyError ? ` — ${data.verifyError}` : ""}. Tap Reconnect and allow ALL permissions.`
        : state === "pending"
          ? "Tap Reconnect, open OG Bot in Telegram, hit Start, and allow ALL permissions."
          : "Tap Reconnect to open OG Bot in Telegram and allow ALL permissions.";

  const Icon =
    state === "verified"
      ? CheckCircle2
      : state === "failed"
        ? XCircle
        : state === "pending"
          ? Loader2
          : AlertCircle;

  return (
    <section
      data-testid="telegram-status-card"
      aria-label="Telegram connection status"
      style={{
        minHeight: "clamp(5rem, 14vw, 6.5rem)",
        // Self-protect: never let an over-eager parent crush us into a
        // single-character vertical strip. Will clip via the app's
        // global `overflow-x: hidden` rather than collapse.
        minWidth: "min(100%, 16rem)",
        contain: "layout paint",
      }}
      className={`flex w-full min-w-0 flex-col gap-3 rounded-2xl border-2 px-4 py-3 backdrop-blur-md sm:flex-row sm:items-center sm:gap-4 ${tone.border} ${tone.bg}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone.iconBg} ${tone.iconText}`}
        >
          <Icon className={`h-5 w-5 ${state === "pending" ? "animate-spin" : ""}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            data-testid="telegram-status-headline"
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-bold uppercase tracking-[0.08em] leading-tight [overflow-wrap:anywhere] [font-size:clamp(0.95rem,3.4vw,1.5rem)] sm:tracking-[0.12em]"
          >
            <MessageCircle className="h-5 w-5 shrink-0" />
            <span className="min-w-0 whitespace-normal">{headline}</span>
          </p>
          <p
            data-testid="telegram-status-detail"
            className="min-w-0 whitespace-normal text-muted-foreground leading-snug [overflow-wrap:anywhere] [font-size:clamp(0.8rem,2.6vw,1rem)]"
          >
            {detail}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
        {canReconnect ? (
          <a
            href="#reconnect-telegram"
            role="button"
            aria-label="Reconnect Telegram"
            aria-busy={reconnecting}
            onClick={handleReconnect}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white shadow-lg shadow-sky-500/30 transition hover:from-sky-400 hover:to-indigo-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            {reconnecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Reconnect
          </a>
        ) : null}
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone.pill}`}
        >
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {label}
        </span>
      </div>
    </section>
  );
}
