import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Send, Users, Loader2, Trash2, Coins, Flag, Trophy, Eraser } from "lucide-react";
import { TypingDots } from "@/components/ui/typing-dots";
import { toast } from "sonner";
import {
  listCommunityMessages,
  listOlderCommunityMessages,
  postCommunityMessage,
  clearCommunityMessages,
  clearMyBattleHistory,
  claimGuestBattleMessages,
  getBattleTally,
  getRoastOfTheDay,
  endBattle,
  getBattleLeaderboard,
  listMyCommunityBlocks,
  blockCommunityUser,
  reportCommunityMessage,
  type BattleLeaderboardRow,
  type CommunityMessage,
} from "@/lib/community.functions";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useFoulMouth } from "@/hooks/use-foul-mouth";
import { useRole } from "@/hooks/use-role";
import ogBotAsset from "@/assets/ogbot.png.asset.json";

function initials(name: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const TYPING_TTL_MS = 4000;

type BattleTally = {
  pendingTenths: number;
  rounds: number;
  totalAwardedCoins: number;
  streakDays?: number;
};

export function CommunityRoom() {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const qc = useQueryClient();
  const listFn = useServerFn(listCommunityMessages);
  const olderFn = useServerFn(listOlderCommunityMessages);
  const postFn = useServerFn(postCommunityMessage);
  const clearFn = useServerFn(clearCommunityMessages);
  const tallyFn = useServerFn(getBattleTally);
  const endFn = useServerFn(endBattle);
  const { foulMouth } = useFoulMouth();
  const { isDev, isAdmin } = useRole();
  const canClear = isDev || isAdmin;
  // Report / Block are app-store safety tools — always visible so store
  // reviewers (who test in a browser) can see them.
  const [nativeApp, setNativeApp] = useState(false);
  useEffect(() => setNativeApp(Capacitor.isNativePlatform()), []);
  const blocksFn = useServerFn(listMyCommunityBlocks);
  const blockFn = useServerFn(blockCommunityUser);
  const reportFn = useServerFn(reportCommunityMessage);
  const { data: blockData } = useQuery({
    queryKey: ["community-blocks"],
    queryFn: () => blocksFn(),
    enabled: !!myId,
    staleTime: 60_000,
  });
  const blockedSet = useMemo(() => new Set(blockData?.blocked ?? []), [blockData]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("og-bz-hidden");
      if (raw) setHiddenIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* private mode */
    }
  }, []);
  const reportMsg = async (id: string) => {
    try {
      await reportFn({ data: { messageId: id } });
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        try {
          localStorage.setItem("og-bz-hidden", JSON.stringify([...next].slice(-500)));
        } catch {
          /* private mode */
        }
        return next;
      });
      toast.success("Message reported and hidden from your view. We review reports within 24 hours.");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't send report");
    }
  };
  const blockUser = async (uid: string) => {
    try {
      await blockFn({ data: { userId: uid } });
      await qc.invalidateQueries({ queryKey: ["community-blocks"] });
      toast.success("Blocked — you won't see their messages any more.");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't block");
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["community-messages"],
    queryFn: () => listFn(),
    staleTime: 10_000,
  });
  const { data: tally } = useQuery<BattleTally>({
    queryKey: ["battle-tally"],
    queryFn: () => tallyFn(),
    staleTime: 30_000,
  });
  const roastFn = useServerFn(getRoastOfTheDay);
  const { data: roastOfDay } = useQuery({
    queryKey: ["roast-of-the-day"],
    queryFn: () => roastFn(),
    staleTime: 120_000,
  });
  const boardFn = useServerFn(getBattleLeaderboard);
  const [showBoard, setShowBoard] = useState(false);
  const { data: board, isLoading: boardLoading } = useQuery<{ rows: BattleLeaderboardRow[] }>({
    queryKey: ["battle-leaderboard"],
    queryFn: () => boardFn(),
    enabled: showBoard,
    staleTime: 30_000,
  });
  const [lastEarned, setLastEarned] = useState<number | null>(null);
  const pendingCoins = ((tally?.pendingTenths ?? 0) / 10).toFixed(2);
  const messages: CommunityMessage[] = useMemo(
    () =>
      (data?.messages ?? []).filter(
        (m) => !hiddenIds.has(m.id) && (!m.user_id || !blockedSet.has(m.user_id)),
      ),
    [data?.messages, blockedSet, hiddenIds],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [jumpAnnounce, setJumpAnnounce] = useState("");
  const [text, setText] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; at: number }>>({});
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 56), 144)}px`;
  }, [text]);

  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const didInitialScrollRef = useRef(false);

  // Realtime: new messages (dedup by id)
  useEffect(() => {
    const channel = supabase
      .channel("community-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "community_messages" },
        (payload) => {
          const row = payload.new as CommunityMessage;
          qc.setQueryData<{ messages: CommunityMessage[] } | undefined>(
            ["community-messages"],
            (prev) => {
              const existing = prev?.messages ?? [];
              if (existing.some((m) => m.id === row.id)) return prev;
              return { messages: [...existing, row] };
            },
          );
          if (!stickToBottomRef.current && row.user_id !== myId) {
            setNewCount((n) => n + 1);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // Realtime: typing indicator via broadcast
  useEffect(() => {
    if (!myId) return;
    const channel = supabase.channel("community-typing", {
      config: { broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "typing" }, ({ payload }) => {
      const { userId, name } = (payload ?? {}) as { userId?: string; name?: string };
      if (!userId || userId === myId) return;
      setTypingUsers((prev) => ({
        ...prev,
        [userId]: { name: name || "Someone", at: Date.now() },
      }));
    });
    channel.subscribe();
    typingChannelRef.current = channel;
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.at < TYPING_TTL_MS) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [myId]);

  const broadcastTyping = useCallback(() => {
    if (!myId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    const ch = typingChannelRef.current;
    if (!ch) return;
    ch.send({
      type: "broadcast",
      event: "typing",
      payload: {
        userId: myId,
        name: user?.user_metadata?.display_name || user?.email?.split("@")[0] || "OG member",
      },
    });
  }, [myId, user]);

  // Virtualizer — windows the message list so very long histories stay smooth.
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 58,
    overscan: 8,
    getItemKey: (i) => messages[i]?.id ?? i,
  });

  // Initial scroll to bottom once the first page has rendered.
  useLayoutEffect(() => {
    if (didInitialScrollRef.current || messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    el.scrollTop = el.scrollHeight;
    didInitialScrollRef.current = true;
  }, [messages.length, rowVirtualizer]);

  // Auto-scroll to newest only if user is already near the bottom.
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    if (!stickToBottomRef.current || messages.length === 0) return;
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages.length, rowVirtualizer]);

  // Scroll handler: track near-bottom + trigger cursor pagination on top.
  const onScroll = useCallback(async () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 120;
    stickToBottomRef.current = nearBottom;
    setShowJump(!nearBottom && messages.length > 0);
    if (nearBottom) setNewCount(0);

    if (el.scrollTop > 40 || loadingOlder || !hasMore || messages.length === 0) return;

    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    try {
      const res = await olderFn({
        data: { before: oldest.created_at, beforeId: oldest.id, limit: 50 },
      });
      if (res.messages.length === 0) {
        setHasMore(false);
      } else {
        setHasMore(res.hasMore);
        qc.setQueryData<{ messages: CommunityMessage[] } | undefined>(
          ["community-messages"],
          (prev) => {
            const existing = prev?.messages ?? [];
            const seen = new Set(existing.map((m) => m.id));
            const merged = [...res.messages.filter((m) => !seen.has(m.id)), ...existing];
            return { messages: merged };
          },
        );
        // Preserve scroll position after prepending older messages.
        requestAnimationFrame(() => {
          const node = scrollRef.current;
          if (node) node.scrollTop = node.scrollHeight - prevHeight + prevTop;
        });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMore, loadingOlder, messages, olderFn, qc]);

  const jumpToBottom = useCallback(
    (quiet = false) => {
      stickToBottomRef.current = true;
      setShowJump(false);
      setNewCount(0);
      const el = scrollRef.current;
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (messages.length > 0) {
        rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      }
      // Smooth scroll on the container as a fallback (virtualizer jumps instantly).
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
        });
      }
      if (quiet) return;
      // Announce arrival and hand focus to the composer so screen readers and
      // keyboard users regain reading context.
      setJumpAnnounce("Jumped to newest messages");
      window.setTimeout(() => {
        composerRef.current?.focus({ preventScroll: true });
        setJumpAnnounce("");
      }, 350);
    },
    [messages.length, rowVirtualizer],
  );

  const send = useMutation({
    mutationFn: (content: string) => postFn({ data: { content, foulMouth } }),
    onSuccess: (res) => {
      setText("");
      stickToBottomRef.current = true;
      const award = (
        res as {
          award?: {
            earnedTenths: number;
            pendingTenths: number;
            rounds: number;
            streakDays?: number;
            streakBonusTenths?: number;
          };
        }
      ).award;
      if (award) {
        qc.setQueryData(["battle-tally"], (prev: BattleTally | undefined) => ({
          pendingTenths: award.pendingTenths,
          rounds: award.rounds,
          totalAwardedCoins: prev?.totalAwardedCoins ?? 0,
          streakDays: award.streakDays ?? prev?.streakDays ?? 0,
        }));
        if (award.earnedTenths > 0) {
          setLastEarned(award.earnedTenths);
          window.setTimeout(() => setLastEarned(null), 2500);
        }
        if ((award.streakBonusTenths ?? 0) > 0) {
          toast.success(
            `${award.streakDays}-day streak — bonus +${((award.streakBonusTenths ?? 0) / 10).toFixed(2)} OG`,
          );
        }
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const quit = useMutation({
    mutationFn: () => endFn(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["battle-tally"] });
      qc.invalidateQueries({ queryKey: ["battle-leaderboard"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["coin-balance"] });
      if (res.coins > 0) {
        toast.success(`Battle over — ${res.coins} OG Coin${res.coins === 1 ? "" : "s"} banked!`, {
          description: `${res.rounds} round${res.rounds === 1 ? "" : "s"} fought. Come back for more.`,
        });
      } else {
        toast("Battle over — nothing banked this time", {
          description: "Land harder roasts to build up a reward.",
        });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clear = useMutation({
    mutationFn: () => clearFn(),
    onSuccess: () => {
      qc.setQueryData(["community-messages"], { messages: [] });
      toast.success("Live chat cleared");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clearMineFn = useServerFn(clearMyBattleHistory);
  const clearMine = useMutation({
    mutationFn: () => clearMineFn(),
    onSuccess: () => {
      qc.setQueryData(["community-messages"], { messages: [] });
      toast.success("Your chat history is cleared — only for you.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bring across anything they typed as a guest on the welcome page.
  const claimFn = useServerFn(claimGuestBattleMessages);
  useEffect(() => {
    if (!myId) return;
    let gid: string | null = null;
    try {
      gid = localStorage.getItem("og-guest-id");
    } catch {
      /* private mode */
    }
    if (!gid) return;
    claimFn({ data: { guestId: gid } })
      .then(() => {
        try {
          localStorage.removeItem("og-guest-id");
        } catch {
          /* ignore */
        }
        void qc.invalidateQueries({ queryKey: ["community-messages"] });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || send.isPending) return;
    send.mutate(t);
  }

  const activeTypers = Object.values(typingUsers);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-1.5 p-1.5 font-sans sm:p-2">
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
          {(tally?.streakDays ?? 0) > 1 ? (
            <span
              className="inline-flex shrink-0 items-center rounded-full border border-coin/40 bg-coin/10 px-1.5 py-0.5 text-[0.7rem] font-black text-coin"
              title={`${tally?.streakDays}-day streak`}
            >
              🔥{tally?.streakDays}
            </span>
          ) : null}
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
            disabled={quit.isPending}
            aria-label="Bank coins"
            onClick={() => quit.mutate()}
          >
            {quit.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Flag className="h-3.5 w-3.5" />
            )}
            <span>Bank</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={clearMine.isPending}
            title="Clear my chat history (only for me)"
            onClick={() => {
              if (window.confirm("Clear your Battle Zone history? Only your view is cleared — nobody else is affected.")) {
                clearMine.mutate();
              }
            }}
          >
            {clearMine.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Eraser className="h-3 w-3" />
            )}
            <span className="sr-only">Clear my history</span>
          </Button>
          {canClear && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={clear.isPending}
              title="Clear live chat"
              onClick={() => {
                if (window.confirm("Wipe ALL Battle Zone messages? This cannot be undone.")) {
                  clear.mutate();
                }
              }}
            >
              {clear.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              <span className="sr-only">Clear chat</span>
            </Button>
          )}
        </div>
      </div>

      {roastOfDay?.roast ? (
        <div className="flex items-start gap-2 rounded-lg border border-coin/40 bg-coin/10 px-2 py-1.5">
          <span aria-hidden className="text-sm leading-none">
            👑
          </span>
          <div className="min-w-0">
            <p className="text-[0.7rem] font-black uppercase tracking-wider text-coin">
              Roast of the day — {roastOfDay.roast.displayName}
            </p>
            <p className="line-clamp-2 text-xs text-foreground">{roastOfDay.roast.content}</p>
          </div>
        </div>
      ) : null}

      {showBoard && (
        <div className="rounded-xl border border-primary/25 bg-background/70 p-2">
          <p className="mb-1 text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
            Most savage roasters
          </p>
          {boardLoading ? (
            <p className="py-1.5 text-xs text-muted-foreground">Counting the bodies…</p>
          ) : (board?.rows.length ?? 0) === 0 ? (
            <p className="py-1.5 text-xs text-muted-foreground">
              Nobody has banked a win yet. Be the first.
            </p>
          ) : (
            <ol className="space-y-0.5">
              {board!.rows.slice(0, 10).map((row, i) => (
                <li
                  key={row.userId}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs ${
                    row.isMe ? "bg-primary/10 font-bold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 tabular-nums">{i + 1}</span>
                    <span className="truncate">
                      {row.name}
                      {row.isMe ? " (you)" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-primary">{row.coinsWon} OG</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-y-auto overscroll-contain rounded-xl border border-border/40 bg-background/75 p-1.5 backdrop-blur-md sm:p-2.5 [-webkit-overflow-scrolling:touch]"
          style={{ touchAction: "pan-y" }}
        >
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the Battle Zone…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Users className="h-8 w-8 opacity-50" />
              <p className="text-sm">Be the first to throw a bar at OG Bot.</p>
            </div>
          ) : (
            <>
              {loadingOlder && (
                <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading older messages…
                </div>
              )}
              {!hasMore && (
                <div className="py-1 text-center text-[0.7rem] uppercase tracking-wider text-muted-foreground/60">
                  Beginning of chat
                </div>
              )}
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: "relative",
                  width: "100%",
                }}
              >
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const m = messages[vi.index];
                  if (!m) return null;
                  const mine = m.role === "user" && m.user_id === myId;
                  const isBot = m.role === "bot";
                  return (
                    <div
                      key={vi.key}
                      ref={rowVirtualizer.measureElement}
                      data-index={vi.index}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${vi.start}px)`,
                      }}
                    >
                      <div
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
                          className={`min-w-0 max-w-[88%] rounded-xl px-2.5 py-1.5 text-[12px] leading-[1.35] shadow-sm sm:max-w-[82%] sm:text-[13px] lg:max-w-[74%] ${
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
                            {isBot ? "OG Bot" : m.display_name || "OG member"} ·{" "}
                            {formatTime(m.created_at)}
                          </p>
                          <p className="whitespace-pre-wrap break-words leading-snug">
                            {m.content}
                          </p>
                        </div>
                        {!mine && !isBot && m.user_id && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label="Message options"
                              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onSelect={() => void reportMsg(m.id)}>
                                Report message
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onSelect={() => void blockUser(m.user_id!)}
                              >
                                Block user
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {showJump && (
          <Button
            type="button"
            size="sm"
            onClick={() => jumpToBottom()}
            aria-label={
              newCount > 0
                ? `Jump to newest, ${newCount} new message${newCount === 1 ? "" : "s"}`
                : "Jump to newest"
            }
            className={
              "absolute bottom-3 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full shadow-lg " +
              (newCount > 0
                ? "border border-primary bg-primary text-primary-foreground shadow-glow animate-[pop_0.25s_ease-out]"
                : "")
            }
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {newCount > 0
              ? `${newCount > 99 ? "99+" : newCount} new message${newCount === 1 ? "" : "s"}`
              : "Jump to newest"}
          </Button>
        )}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {jumpAnnounce}
        </div>
      </div>

      {activeTypers.length > 0 && (
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <TypingDots size="sm" aria-label="People typing" />
          <span className="truncate">
            {activeTypers.length === 1
              ? `${activeTypers[0].name} is typing…`
              : activeTypers.length === 2
                ? `${activeTypers[0].name} and ${activeTypers[1].name} are typing…`
                : `${activeTypers.length} people are typing…`}
          </span>
        </div>
      )}

      <form
        onSubmit={submit}
        style={{ touchAction: "manipulation" }}
        className="sticky bottom-0 z-40 flex items-end gap-2 rounded-xl border border-border/60 bg-card/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur-md sm:p-2.5"
      >
        <Textarea
          ref={composerRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            broadcastTyping();
          }}
          style={{ touchAction: "manipulation" }}
          onKeyDown={(e) => {
            // On desktop: Enter sends, Shift+Enter newline.
            // On mobile (touch): Enter always inserts newline; tap Send to submit.
            const isTouch =
              typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !isTouch) {
              e.preventDefault();
              submit(e as unknown as React.FormEvent);
            }
          }}
          placeholder="Give me ur best shot — say or ask anything…"
          rows={2}
          maxLength={1000}
          enterKeyHint="send"
          className="min-h-14 max-h-36 resize-none overflow-y-auto border-0 bg-transparent px-2.5 py-2 text-base leading-5 shadow-none focus-visible:ring-0 md:text-[15px]"
          disabled={send.isPending}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || send.isPending}
          className="mb-1 h-11 w-11 shrink-0 rounded-xl"
          aria-label="Send message"
        >
          {send.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </form>
      {nativeApp && (
        <p className="px-3 pb-1 text-center text-xs text-muted-foreground">
          Zero tolerance for abusive content. By chatting you agree to our{" "}
          <a href="/terms" className="underline">
            Terms of Use
          </a>
          .
        </p>
      )}
    </div>
  );
}
