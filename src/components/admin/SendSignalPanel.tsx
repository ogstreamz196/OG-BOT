import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { sendSignalNow } from "@/lib/signal-send.functions";
import { SIGNAL_MARKETS } from "@/lib/signal-markets";
import { Button } from "@/components/ui/button";
import { AdminSection } from "./AdminSection";

const LABEL: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };

/**
 * Boss: send a real signal for a market right now. It runs the exact live scan
 * for that market (same gate, concurrency, desk confirm, tracking and copy as
 * the automatic minute cron), so it only posts if a setup passes the gate this
 * moment. The Copy Trader B0T copies anything that posts, so it's confirmed
 * first.
 */
export function SendSignalPanel() {
  const send = useServerFn(sendSignalNow);
  const [market, setMarket] = useState<string>(SIGNAL_MARKETS[0]);

  const mut = useMutation({
    mutationFn: () => send({ data: { market } }),
    onSuccess: (res) => {
      if (res.sent) toast.success(res.message);
      else toast(res.message);
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't send"),
  });

  const go = () => {
    const label = LABEL[market] ?? market;
    if (
      !window.confirm(
        `Send a live ${label} signal now?\n\nIf a setup passes the gate it posts to the signals chat and the Copy Trader B0T will trade it. If nothing qualifies right now, nothing is sent.`,
      )
    )
      return;
    mut.mutate();
  };

  return (
    <AdminSection
      icon={<Send className="h-4 w-4 text-emerald-400" />}
      title="Send a signal now"
      subtitle="Pick a market and send the bot's next real setup to the signals chat on demand, through the same path as the automatic scanner. It only posts if a setup passes the gate this moment; otherwise nothing is sent."
    >
      <div className="flex flex-wrap items-center gap-2">
        {SIGNAL_MARKETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              market === m
                ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            {LABEL[m] ?? m}
          </button>
        ))}
        <Button onClick={go} disabled={mut.isPending} className="ml-auto">
          {mut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Send {LABEL[market] ?? market} signal
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        This is a real, copy-traded signal, not a preview. It's checked against the live gate and
        concurrency limits just like an automatic alert, and tracked and followed the same way.
      </p>
    </AdminSection>
  );
}
