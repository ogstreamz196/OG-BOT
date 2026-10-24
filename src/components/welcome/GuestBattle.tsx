import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Eraser, MoreVertical } from "lucide-react";
import { toast } from "sonner";
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
import {
  ArenaComposer,
  ArenaEmpty,
  ArenaFrame,
  ArenaHeader,
  ArenaMessage,
  ArenaRanks,
  ArenaRoastOfDay,
  ArenaTyping,
} from "@/components/battle/Arena";

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
  const [showRoast, setShowRoast] = useState(true);
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

  // Follow new lines only while the guest is at the bottom (or just sent one),
  // so scrolling up to read older roasts isn't yanked back down.
  const atBottom = useRef(true);
  useEffect(() => {
    if (!atBottom.current && !sending) return;
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
        else toast("OG B0T's swamped — try again in a minute.");
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
      className="flex h-[min(86dvh,46rem)] min-h-0 flex-col overflow-hidden rounded-xl font-sans"
    >
      {/* Same arena as the members' Battle Zone, without the Go Private toggle. */}
      <ArenaFrame>
        <ArenaHeader
          className="pr-10"
          subtitle={myName ? `Live battle · you're ${myName}` : "Live battle · everyone can see"}
          thinking={sending}
          purse={`${pendingCoins} OG`}
          earned={lastEarned}
          ranksOpen={showBoard}
          onToggleRanks={() => setShowBoard((v) => !v)}
          onBank={bank}
          menu={
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Battle options" className="ar-icon-btn">
                <MoreVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {roast ? (
                  <DropdownMenuItem onSelect={() => setShowRoast((v) => !v)}>
                    {showRoast ? "Hide roast of the day" : "Show roast of the day"}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={clearMine}>
                  <Eraser className="mr-2 h-4 w-4" /> Clear my history (only for me)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        {roast && showRoast ? (
          <ArenaRoastOfDay name={roast.displayName} content={roast.content} />
        ) : null}
        {showBoard ? <ArenaRanks loading={extrasLoading} rows={rows} /> : null}

        <div
          ref={scroller}
          className="ar-feed"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {isLoading || !guestId || messages.length === 0 ? (
            <ArenaEmpty loading={isLoading || !guestId} />
          ) : (
            messages.map((m, i) => {
              const isBot = m.role === "bot";
              const prev = messages[i - 1];
              return (
                <ArenaMessage
                  key={m.id}
                  kind={isBot ? "bot" : "user"}
                  mine={m.mine}
                  name={isBot ? "OG B0T" : m.display_name || "OG member"}
                  time={m.created_at ? time(m.created_at) : ""}
                  content={m.content}
                  vip={!isBot && m.vip}
                  vipId={m.vip_id}
                  scoreTenths={isBot && prev?.role === "user" ? prev.score_tenths : null}
                  menu={
                    !m.mine && !isBot ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label="Message options"
                          className="ar-bubble-menu"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onSelect={() => hideMsg(m.id)}>
                            Hide message
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null
                  }
                />
              );
            })
          )}
        </div>

        {sending ? <ArenaTyping label="OG B0T is cooking a comeback…" /> : null}

        {remaining > 0 ? (
          <ArenaComposer
            value={text}
            onChange={setText}
            onSubmit={submit}
            pending={sending}
            disabled={!guestId}
            maxLength={400}
          />
        ) : (
          <div className="ar-console flex-col items-stretch text-center">
            <p className="ar-white text-sm font-bold">
              Join free to keep battling — your chat and your winnings come with you.
            </p>
            <button type="button" className="ar-vip-cta mt-2" onClick={onNeedAccount}>
              🔥 Join to continue
            </button>
          </div>
        )}
      </ArenaFrame>
    </section>
  );
}

function time(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
