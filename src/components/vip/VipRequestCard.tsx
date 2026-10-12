import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/use-role";
import { sendVipRequest } from "@/lib/vip-request.functions";

const KINDS = [
  { id: "style", label: "🎵 Style" },
  { id: "language", label: "🌍 Language" },
  { id: "other", label: "💡 Other" },
] as const;

export function VipRequestCard() {
  const { isVip } = useRole();
  const send = useServerFn(sendVipRequest);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("style");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (msg.trim().length < 3) return toast.error("Tell us a bit more");
    setBusy(true);
    try {
      await send({ data: { kind, message: msg.trim() } });
      toast.success("Sent straight to the Boss 👑");
      setMsg("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-coin/40 bg-coin/5 p-5">
      <h2 className="flex items-center gap-2 font-display text-base font-black">
        <Crown className="h-4 w-4 text-coin" /> Request a style or language
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Want a sound, dialect or language we don't have yet? VIPs can message the Boss directly.
      </p>
      {isVip ? (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-bold",
                  kind === k.id
                    ? "border-coin bg-coin/20 text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          <Textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            maxLength={800}
            placeholder="e.g. Somali drill, Sylheti lyrics, 80s Bollywood disco…"
          />
          <Button onClick={submit} disabled={busy} className="w-full gap-2 font-bold">
            <Send className="h-4 w-4" /> {busy ? "Sending…" : "Send to the Boss"}
          </Button>
        </div>
      ) : (
        <Button asChild variant="outline" className="mt-3 w-full gap-2 font-bold">
          <Link to="/buy-coins">
            <Lock className="h-4 w-4" /> Unlock with OG VIP
          </Link>
        </Button>
      )}
    </section>
  );
}
