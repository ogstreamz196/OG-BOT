import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Send, Swords } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GUEST_MESSAGE_LIMIT,
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
  const remaining = data?.remaining ?? GUEST_MESSAGE_LIMIT;
  const messages = data?.messages ?? [];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

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
    <section id="battle" className="relative mx-auto max-w-3xl scroll-mt-24 px-3 py-10 sm:px-8">
      <p className="text-center text-xs font-black uppercase tracking-[0.25em] text-primary">
        OG Battle Zone · live
      </p>
      <h2 className="font-display mt-2 text-center text-3xl font-black tracking-tight sm:text-5xl">
        Roast OG Bot. Right now.
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted-foreground">
        Everyone in here can gang up on the bot. You get {GUEST_MESSAGE_LIMIT} free roasts —
        then join to keep going.
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card/70 backdrop-blur">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs font-bold">
          <span className="inline-flex items-center gap-1.5">
            <Swords className="h-3.5 w-3.5 text-primary" /> Battle Zone
          </span>
          <span className={remaining > 0 ? "text-primary" : "text-destructive"}>
            Roasts left: {remaining}/{GUEST_MESSAGE_LIMIT}
          </span>
        </div>
        <div ref={scroller} className="h-72 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <p className="pt-24 text-center text-sm text-muted-foreground">
              Throw your first roast — the chat starts from your first message.
            </p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.mine ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {!m.mine && (
                    <p className="text-[10px] font-black uppercase tracking-wide opacity-70">
                      {m.role === "bot" ? "OG Bot" : m.display_name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ))
          )}
          {sending && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> OG Bot is cooking a comeback…
            </p>
          )}
        </div>
        {remaining > 0 ? (
          <form onSubmit={submit} className="flex gap-2 border-t border-border/60 p-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={400}
              placeholder="Say something savage…"
              disabled={sending || !guestId}
              className="h-11"
            />
            <Button type="submit" disabled={sending || !text.trim()} className="h-11 px-4">
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        ) : (
          <div className="border-t border-border/60 p-3 text-center">
            <p className="text-sm font-semibold">That's your 5. Join free to keep battling — your chat comes with you.</p>
            <Button className="mt-2 h-11 w-full" onClick={onNeedAccount}>
              🔥 Join to continue
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
