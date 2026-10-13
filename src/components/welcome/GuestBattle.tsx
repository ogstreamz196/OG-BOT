import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Coins, Eraser, Flag, Loader2, MoreVertical, Send, Trophy, Users } from "lucide-react";
import ogBotAsset from "@/assets/ogbot.png.asset.json";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TypingDots } from "@/components/ui/typing-dots";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getGuestBattleExtras,
  listGuestBattleMessages,
  postGuestBattleMessage,
} from "@/lib/community.functions";

const GUEST_KEY = "og-guest-id";
const CLEARED_KEY = "og-guest-cleared-at";
const HIDDEN_KEY = "og-bz-hidden";

function useGuestId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    try {
      let g = localStorage.getItem(GUEST_KEY);
      if (!g) {
        g = crypto.randomUUID();
        localStorage.setItem(GUEST_KEY, g);
      }
      setId(g);
    } catch {
      setId(crypto.randomUUID());
    }
  }, []);
  return id;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/**
 * Guest Battle Zone: the same room members get (purse, ranks, bank, roast of
 * the day, clear my history), minus the Go Private toggle. Guests get 5
 * roasts before sign-up, see history only from their first line, and their
 * winnings follow them into their new account.
 */
export function GuestBattle({ onNeedAccount }: { onNeedAccount: () => void }) {
  const guestId = useGuestId();
  const qc = useQueryClient();
  const listFn = useServerFn(listGuestBattleMessages);
  const postFn = useServerFn(postGuestBattleMessage);
  const extrasFn = useServerFn(getGuestBattleExtras);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [lastEarned, setLastEarned] = useState<number | null>(null);
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setClearedAt(readLocal(CLEARED_KEY));
    try {
      const raw = readLocal(HIDDEN_KEY);
      if (raw) setHiddenIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["guest-battle", guestId],
    queryFn: () => listFn({ data: { guestId: guestId! } }),
    enabled: !!guestId,
    refetchInterval: 8000,
  });
  const { data: extras, isLoading: extrasLoading } = useQuery({
    queryKey: ["guest-battle-extras"],
    queryFn: () => extrasFn(),
    staleTime: 60_000,
  });

  const remaining = data?.remaining ?? 1;
  const myName = data?.myName ?? "";
  const pendingCoins = ((data?.pendingTenths ?? 0) / 10).toFixed(2);
  const messages = useMemo(
    () =>
      (data?.messages ?? []).filter(
        (m) => !hiddenIds.has(m.id) && (!clearedAt || m.created_at > clearedAt),
      ),
    [data?.messages, hiddenIds, clearedAt],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, sending]);

  // Automatically prompt sign-in once the guest limit is reached,
  // after a short beat so the bot's last comeback is seen.
  useEffect(() => {
    if (data && data.remaining <= 0) {
      const t = setTimeout(onNeedAccount, 2500);
      return () => clearTimeout(t);
    }
  }, [data, onNeedAccount]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!guestId || !text.trim() || sending) return;
    if (remaining <= 0) return onNeedAccount();
    setSending(true);
    try {
      const res = await postFn({ data: { guestId, content: text.trim() } });
      if (!res.ok) {
        if (res.reason === "limit") onNeedAccount();
        else toast("OG Bot's swamped — try again in a minute.");
      } else {
        setText("");
        const earned = res.award?.earnedTenths ?? 0;
        if (earned > 0) {
          setLastEarned(earned);
          window.setTimeout(() => setLastEarned(null), 2500);
        }
        if (res.remaining === 0) setTimeout(onNeedAccount, 2500);
      }
      await qc.invalidateQueries({ queryKey: ["guest-battle", guestId] });
    } catch (err) {
      toast.error((err as Error).message || "Couldn't send that one");
    } finally {
      setSending(false);
    }
  }

  function bank() {
    if ((data?.pendingTenths ?? 0) > 0) {
      toast(`Join free to bank your ${pendingCoins} OG`, {
        description: "Your winnings and your chat come with you.",
      });
    } else {
      toast("Nothing to bank yet", { description: "Land harder roasts to build up a reward." });
    }
    onNeedAccount();
  }

  function clearMine() {
    if (
      !window.confirm(
        "Clear your Battle Zone history? Only your view is cleared — nobody else is affected.",
      )
    ) {
      return;
    }
    const now = new Date().toISOString();
    writeLocal(CLEARED_KEY, now);
    setClearedAt(now);
    toast.success("Your chat history is cleared — only for you.");
  }

  function hideMsg(id: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeLocal(HIDDEN_KEY, JSON.stringify([...next].slice(-500)));
      return next;
    });
    toast.success("Message hidden from your view.");
  }

  const roast = extras?.roast ?? null;
  const rows = extras?.rows ?? [];

  return (
    <section
      id="battle"
      className="hell-aura relative flex h-[min(86dvh,46rem)] min-h-0 flex-col overflow-hidden rounded-xl bg-gradient-to-b from-[#1a0505]/95 via-[#220808]/90 to-[#0d0202]/95 font-sans"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.35),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(220,38,38,0.3),transparent_65%)] animate-pulse"
      />
      {/* Header — same as the members' Battle Zone, without the Go Private toggle. */}
      <header className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-border/60 bg-gradient-to-r from-cyan-500/20 via-sky-500/10 to-fuchsia-500/15 px-2.5 py-1.5 pr-10 backdrop-blur-xl sm:gap-3 sm:px-4 sm:py-2">
        <div className="relative shrink-0">
          <span
            aria-hidden
            className="absolute -inset-1 rounded-full bg-gradient-to-br from-cyan-400/40 via-fuchsia-500/30 to-transparent blur-md"
          />
          <span className="relative grid h-8 w-8 place-items-center rounded-full bg-cyan-500/25 ring-1 ring-cyan-400/60 sm:h-9 sm:w-9">
            <Users className="h-4 w-4 text-cyan-100 sm:h-5 sm:w-5" />
          </span>
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-400 sm:h-3 sm:w-3" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-extrabold leading-tight sm:text-base">
            OG Battle Zone
          </h2>
          <p className="flex items-center gap-1 truncate text-[0.7rem] font-medium text-emerald-400 sm:text-xs">
            <span className="relative inline-flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="truncate">
              {myName ? `Live battle · you're ${myName}` : "Live battle · everyone can see"}
            </span>
          </p>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col gap-1.5 p-1.5 sm:p-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Coins className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p
              className="min-w-0 truncate text-xs font-black tabular-nums text-foreground sm:text-sm"
              aria-live="polite"
              title="Battle purse"
            >
              {pendingCoins} OG
              {lastEarned ? (
                <span className="ml-1 animate-[pop_0.3s_ease-out] text-[0.7rem] font-bold text-primary">
                  +{(lastEarned / 10).toFixed(2)}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[0.7rem] font-bold uppercase"
              aria-expanded={showBoard}
              aria-label="Ranks"
              onClick={() => setShowBoard((v) => !v)}
            >
              <Trophy className="h-3.5 w-3.5" />
              <span className="hidden min-[400px]:inline">Ranks</span>
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 gap-1 px-2 text-[0.7rem] font-bold uppercase"
              aria-label="Bank coins"
              onClick={bank}
            >
              <Flag className="h-3.5 w-3.5" />
              <span>Bank</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              title="Clear my chat history (only for me)"
              onClick={clearMine}
            >
              <Eraser className="h-3 w-3" />
              <span className="sr-only">Clear my history</span>
            </Button>
          </div>
        </div>

        {roast ? (
          <div className="flex items-start gap-2 rounded-lg border border-coin/40 bg-coin/10 px-2 py-1.5">
            <span aria-hidden className="text-sm leading-none">
              👑
            </span>
            <div className="min-w-0">
              <p className="text-[0.7rem] font-black uppercase tracking-wider text-coin">
                Roast of the day — {roast.displayName}
              </p>
              <p className="line-clamp-2 text-xs text-foreground">{roast.content}</p>
            </div>
          </div>
        ) : null}

        {showBoard && (
          <div className="rounded-xl border border-primary/25 bg-background/70 p-2">
            <p className="mb-1 text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
              Most savage roasters
            </p>
            {extrasLoading ? (
              <p className="py-1.5 text-xs text-muted-foreground">Counting the bodies…</p>
            ) : rows.length === 0 ? (
              <p className="py-1.5 text-xs text-muted-foreground">
                Nobody has banked a win yet. Be the first.
              </p>
            ) : (
              <ol className="space-y-0.5">
                {rows.slice(0, 10).map((row, i) => (
                  <li
                    key={row.userId}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 tabular-nums">{i + 1}</span>
                      <span className="truncate">{row.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-primary">{row.coinsWon} OG</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-border/40 bg-background/75 p-1.5 backdrop-blur-md sm:p-2.5"
        >
          {isLoading || !guestId ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the Battle Zone…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Users className="h-8 w-8 opacity-50" />
              <p className="text-sm">
                Got the balls? Throw the first bar at OG Bot — he bites back.
              </p>
              {myName ? (
                <p className="text-xs">
                  You're <span className="font-bold text-foreground">{myName}</span> — OG Bot will
                  remind you.
                </p>
              ) : null}
            </div>
          ) : (
            messages.map((m) => {
              const isBot = m.role === "bot";
              const mine = m.mine;
              return (
                <div
                  key={m.id}
                  className={`flex items-end gap-1.5 py-1 motion-safe:animate-[pop_0.2s_ease-out] ${mine ? "flex-row-reverse" : "flex-row"}`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full text-[0.7rem] font-bold uppercase sm:h-7 sm:w-7 ${
                      isBot
                        ? "bg-primary/20 ring-1 ring-primary/40"
                        : mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                    }`}
                  >
                    {isBot ? (
                      <img
                        src={ogBotAsset.url}
                        alt="OG Bot"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials(m.display_name)
                    )}
                  </span>
                  <div
                    className={`min-w-0 max-w-[88%] rounded-xl px-2.5 py-1.5 text-[12px] leading-[1.35] shadow-sm sm:max-w-[82%] sm:text-[13px] ${
                      isBot
                        ? "border border-primary/30 bg-primary/10 text-foreground"
                        : mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                    }`}
                  >
                    <p
                      className={`mb-0.5 text-[0.7rem] font-bold uppercase ${
                        mine ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      {isBot ? "OG Bot" : m.display_name || "OG member"}
                      {m.created_at ? ` · ${time(m.created_at)}` : ""}
                    </p>
                    <p className="whitespace-pre-wrap break-words leading-snug">{m.content}</p>
                  </div>
                  {!mine && !isBot && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label="Message options"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => hideMsg(m.id)}>
                          Hide message
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })
          )}
        </div>

        {sending && (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <TypingDots size="sm" aria-label="OG Bot is typing" />
            <span className="truncate">OG Bot is cooking a comeback…</span>
          </div>
        )}

        {remaining > 0 ? (
          <form
            onSubmit={submit}
            className="flex items-end gap-2 rounded-xl border border-border/60 bg-card/95 p-2 shadow-lg backdrop-blur-md sm:p-2.5"
          >
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                const isTouch =
                  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
                if (e.key === "Enter" && !e.shiftKey && !isTouch) {
                  e.preventDefault();
                  void submit(e as unknown as FormEvent);
                }
              }}
              maxLength={400}
              rows={2}
              enterKeyHint="send"
              placeholder={
                data
                  ? `Give me ur best shot — ${remaining} free roast${remaining === 1 ? "" : "s"} left…`
                  : "Give me ur best shot — say or ask anything…"
              }
              disabled={sending || !guestId}
              className="min-h-14 max-h-36 resize-none border-0 bg-transparent px-2.5 py-2 text-base leading-5 shadow-none focus-visible:ring-0 md:text-[15px]"
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || !text.trim()}
              className="mb-1 h-11 w-11 shrink-0 rounded-xl"
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </form>
        ) : (
          <div className="rounded-xl border border-border/60 bg-card p-3 text-center">
            <p className="text-sm font-semibold">
              Join free to keep battling — your chat and your winnings come with you.
            </p>
            <Button className="mt-2 h-11 w-full" onClick={onNeedAccount}>
              🔥 Join to continue
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function initials(name?: string | null) {
  if (!name) return "OG";
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "OG"
  );
}

function time(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
