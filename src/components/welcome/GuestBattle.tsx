import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Send, Swords, Users } from "lucide-react";
import ogBotAsset from "@/assets/ogbot.png.asset.json";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  listGuestBattleMessages,
  postGuestBattleMessage,
} from "@/lib/community.functions";

const GUEST_KEY = "og-guest-id";

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

/** Guest Battle Zone: 5 roasts before sign-up, history only from their first line. */
export function GuestBattle({ onNeedAccount }: { onNeedAccount: () => void }) {
  const guestId = useGuestId();
  const qc = useQueryClient();
  const listFn = useServerFn(listGuestBattleMessages);
  const postFn = useServerFn(postGuestBattleMessage);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ["guest-battle", guestId],
    queryFn: () => listFn({ data: { guestId: guestId! } }),
    enabled: !!guestId,
    refetchInterval: 8000,
  });
  const remaining = data?.remaining ?? 1;
  const messages = data?.messages ?? [];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

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
    if (!guestId || !text.trim()) return;
    if (remaining <= 0) return onNeedAccount();
    setSending(true);
    try {
      const res = await postFn({ data: { guestId, content: text.trim() } });
      if (!res.ok) {
        if (res.reason === "limit") onNeedAccount();
        else toast("OG Bot's swamped — try again in a minute.");
      } else {
        setText("");
        if (res.remaining === 0) setTimeout(onNeedAccount, 2500);
      }
      await qc.invalidateQueries({ queryKey: ["guest-battle", guestId] });
    } catch (err) {
      toast.error((err as Error).message || "Couldn't send that one");
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="battle" className="flex h-[min(80dvh,44rem)] min-h-0 flex-col gap-1.5 font-sans">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1.5 pr-9">
        <div className="flex min-w-0 items-center gap-1.5">
          <Swords className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate text-xs font-black uppercase sm:text-sm">OG Battle Zone</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-black uppercase text-destructive">
          🤬 Foul mouth · Live
        </span>
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-border/40 bg-background/75 p-1.5 backdrop-blur-md sm:p-2.5"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Users className="h-8 w-8 opacity-50" />
            <p className="text-sm">Be the first to throw a bar at OG Bot.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isBot = m.role === "bot";
            const mine = m.mine;
            return (
              <div key={m.id} className={`flex items-end gap-1.5 py-1 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full text-[8px] font-bold uppercase ${
                    isBot ? "bg-primary/20 ring-1 ring-primary/40" : mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {isBot ? (
                    <img src={ogBotAsset.url} alt="OG Bot" className="h-full w-full object-cover" />
                  ) : (
                    initials(mine ? "You" : m.display_name)
                  )}
                </span>
                <div
                  className={`min-w-0 max-w-[82%] rounded-xl px-2.5 py-1.5 text-[13px] leading-[1.35] shadow-sm ${
                    isBot ? "border border-primary/30 bg-primary/10 text-foreground" : mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  <p className={`mb-0.5 text-[8px] font-bold uppercase ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {isBot ? "OG Bot" : mine ? "You" : m.display_name || "OG member"}
                    {m.created_at ? ` · ${time(m.created_at)}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap break-words leading-snug">{m.content}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {sending && (
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> OG Bot is cooking a comeback…
        </div>
      )}

      {remaining > 0 ? (
        <form
          onSubmit={submit}
          className="flex items-end gap-2 rounded-xl border border-border/60 bg-card/95 p-2 shadow-lg backdrop-blur-md"
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(e as unknown as FormEvent);
              }
            }}
            maxLength={400}
            rows={2}
            placeholder="Roast OG Bot…"
            disabled={sending || !guestId}
            className="min-h-14 max-h-36 resize-none border-0 bg-transparent px-2.5 py-2 text-base leading-5 shadow-none focus-visible:ring-0"
          />
          <Button type="submit" disabled={sending || !text.trim()} className="mb-1 h-11 w-11 shrink-0 rounded-xl p-0">
            <Send className="h-5 w-5" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card p-3 text-center">
          <p className="text-sm font-semibold">Join free to keep battling — your chat comes with you.</p>
          <Button className="mt-2 h-11 w-full" onClick={onNeedAccount}>
            🔥 Join to continue
          </Button>
        </div>
      )}
    </section>
  );
}

function initials(name?: string | null) {
  return (name ?? "OG").trim().slice(0, 2) || "OG";
}

function time(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
