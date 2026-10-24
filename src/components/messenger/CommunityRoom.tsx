import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Loader2, Trash2, Eraser } from "lucide-react";
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
import { BattleCapDialog } from "@/components/battle/BattleCapDialog";
import { Capacitor } from "@capacitor/core";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useFoulMouth } from "@/hooks/use-foul-mouth";
import { useRole } from "@/hooks/use-role";
import {
  ArenaComposer,
  ArenaEmpty,
  ArenaFrame,
  ArenaHeader,
  ArenaMessage,
  ArenaRanks,
  ArenaRoastOfDay,
  ArenaTyping,
  ArenaVipPromo,
} from "@/components/battle/Arena";

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
  const { isDev, isAdmin, hasVipRole } = useRole();
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
      toast.success(
        "Message reported and hidden from your view. We review reports within 24 hours.",
      );
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
  const [showRoast, setShowRoast] = useState(true);
  const [vipPromoOpen, setVipPromoOpen] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
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
              // Live rows don't carry VIP badges; reuse the sender's from earlier lines.
              const known = row.user_id
                ? existing.find((m) => m.user_id === row.user_id && m.vip !== undefined)
                : undefined;
              const withBadge = known ? { ...row, vip: known.vip, vip_id: known.vip_id } : row;
              return { messages: [...existing, withBadge] };
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
    // Real bubbles are ~90–200px; a close estimate stops jumps while measuring.
    estimateSize: () => 120,
    overscan: 10,
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
            capHit?: boolean;
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
        if (award.capHit) {
          toast.success("Congrats — you banked 2 OG Coins today! 🏆");
          setCapOpen(true);
        }
        if (award.earnedTenths > 0) {
          setLastEarned(award.earnedTenths);
          window.setTimeout(() => setLastEarned(null), 2500);
          // Show the round's score on OG Bot's reply straight away.
          const sentId = (res as { message?: { id?: string } }).message?.id;
          if (sentId) {
            qc.setQueryData<{ messages: CommunityMessage[] } | undefined>(
              ["community-messages"],
              (prev) =>
                prev && {
                  messages: prev.messages.map((m) =>
                    m.id === sentId ? { ...m, score_tenths: award.earnedTenths } : m,
                  ),
                },
            );
          }
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
      setCapOpen(false);
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
      .then((res) => {
        try {
          localStorage.removeItem("og-guest-id");
        } catch {
          /* ignore */
        }
        void qc.invalidateQueries({ queryKey: ["community-messages"] });
        void qc.invalidateQueries({ queryKey: ["battle-tally"] });
        if (res.creditedTenths > 0) {
          toast.success(
            `Your guest winnings came with you — ${(res.creditedTenths / 10).toFixed(2)} OG in your purse. Tap Bank to cash out.`,
          );
        }
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

  const myName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "OG member";

  return (
    <ArenaFrame className="h-full font-sans">
      <BattleCapDialog
        open={capOpen}
        onOpenChange={setCapOpen}
        purse={`${pendingCoins} OG`}
        onWithdraw={() => quit.mutate()}
        withdrawing={quit.isPending}
      />
      <ArenaHeader
        compact
        subtitle={`Live battle · you're ${myName}`}
        thinking={send.isPending}
        purse={`${pendingCoins} OG`}
        earned={lastEarned}
        streakDays={tally?.streakDays}
        ranksOpen={showBoard}
        onToggleRanks={() => setShowBoard((v) => !v)}
        onBank={() => quit.mutate()}
        bankPending={quit.isPending}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Battle options" className="ar-icon-btn">
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {roastOfDay?.roast ? (
                <DropdownMenuItem onSelect={() => setShowRoast((v) => !v)}>
                  {showRoast ? "Hide roast of the day" : "Show roast of the day"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={clearMine.isPending}
                onSelect={() => {
                  if (
                    window.confirm(
                      "Clear your Battle Zone history? Only your view is cleared — nobody else is affected.",
                    )
                  ) {
                    clearMine.mutate();
                  }
                }}
              >
                <Eraser className="mr-2 h-4 w-4" /> Clear my history (only for me)
              </DropdownMenuItem>
              {canClear ? (
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={clear.isPending}
                  onSelect={() => {
                    if (window.confirm("Wipe ALL Battle Zone messages? This cannot be undone.")) {
                      clear.mutate();
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Clear live chat for everyone
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {roastOfDay?.roast && showRoast ? (
        <ArenaRoastOfDay name={roastOfDay.roast.displayName} content={roastOfDay.roast.content} />
      ) : null}
      {showBoard ? <ArenaRanks loading={boardLoading} rows={board?.rows ?? []} /> : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="ar-feed ar-feed--fill"
          style={{ touchAction: "pan-y" }}
        >
          {isLoading || messages.length === 0 ? (
            <ArenaEmpty loading={isLoading} />
          ) : (
            <>
              {loadingOlder && (
                <div className="ar-silver flex items-center justify-center py-2 text-xs">
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading older messages…
                </div>
              )}
              {!hasMore && (
                <div className="ar-silver py-1 text-center text-[0.7rem] uppercase tracking-wider">
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
                  const prev = messages[vi.index - 1];
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
                      <ArenaMessage
                        kind={isBot ? "bot" : "user"}
                        mine={mine}
                        name={isBot ? "0G B0T" : m.display_name || "OG member"}
                        time={formatTime(m.created_at)}
                        content={m.content}
                        vip={!isBot && !!m.vip}
                        vipId={m.vip_id}
                        scoreTenths={isBot && prev?.role === "user" ? prev.score_tenths : null}
                        onVipClick={hasVipRole ? undefined : () => setVipPromoOpen(true)}
                        menu={
                          !mine && !isBot && m.user_id ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                aria-label="Message options"
                                className="ar-bubble-menu"
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
                          ) : null
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {showJump && (
          <button
            type="button"
            onClick={() => jumpToBottom()}
            aria-label={
              newCount > 0
                ? `Jump to newest, ${newCount} new message${newCount === 1 ? "" : "s"}`
                : "Jump to newest"
            }
            className="ar-icon-btn ar-jump absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 rounded-full px-3"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {newCount > 0
              ? `${newCount > 99 ? "99+" : newCount} new message${newCount === 1 ? "" : "s"}`
              : "Jump to newest"}
          </button>
        )}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {jumpAnnounce}
        </div>
      </div>

      {send.isPending ? (
        <ArenaTyping label="0G B0T is cooking a comeback…" />
      ) : activeTypers.length > 0 ? (
        <ArenaTyping
          label={
            activeTypers.length === 1
              ? `${activeTypers[0].name} is typing…`
              : activeTypers.length === 2
                ? `${activeTypers[0].name} and ${activeTypers[1].name} are typing…`
                : `${activeTypers.length} people are typing…`
          }
        />
      ) : null}

      <ArenaComposer
        ref={composerRef}
        value={text}
        onChange={(v) => {
          setText(v);
          broadcastTyping();
        }}
        onSubmit={submit}
        pending={send.isPending}
        disabled={send.isPending}
        maxLength={1000}
      />
      {nativeApp && (
        <p className="ar-silver px-3 pb-1 text-center text-xs">
          Zero tolerance for abusive content. By chatting you agree to our{" "}
          <a href="/terms" className="underline">
            Terms of Use
          </a>
          .
        </p>
      )}
      <ArenaVipPromo open={vipPromoOpen} onClose={() => setVipPromoOpen(false)} />
    </ArenaFrame>
  );
}
