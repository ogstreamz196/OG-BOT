import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getSignalsChatState,
  purgeSignalsChat,
  startSignalsDemo,
} from "@/lib/signals-chat.functions";
import { AdminSection } from "./AdminSection";

const KEY = ["signals-chat-state"];

/** Money with cents only when there are cents: $1,000, $1,042.30. */
const usd = (n: number) =>
  `$${n
    .toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\.00$/, "")}`;

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * Boss: start the signals chat fresh. One button clears the chat, restarts
 * every counter and the test account at a new balance, and posts the Vantage
 * invite and the test-mode note. Nothing stored is deleted.
 */
export function SignalsChatResetPanel() {
  const qc = useQueryClient();
  const load = useServerFn(getSignalsChatState);
  const purge = useServerFn(purgeSignalsChat);
  const demo = useServerFn(startSignalsDemo);
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => load() });
  const [balance, setBalance] = useState("1000");
  const [confirm, setConfirm] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.start) setBalance(String(data.start));
  }, [data?.start]);

  const amount = Number(balance);
  const valid = Number.isFinite(amount) && amount >= 10 && amount <= 1_000_000;

  async function run() {
    setBusy(true);
    try {
      const out = await purge({ data: { balance: amount } });
      if (!out.ok) throw new Error(out.why ?? "Couldn't start fresh");
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(
        out.deleteRefused
          ? `Started fresh at ${usd(amount)}. Some old messages couldn't be deleted (${out.deleteRefused}).`
          : `Started fresh at ${usd(amount)}. Chat cleared.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start fresh");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  async function runDemo() {
    setBusy(true);
    try {
      const out = await demo({ data: { balance: amount } });
      if (!out.ok) throw new Error(out.why ?? "Couldn't start the demo");
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(
        out.announced
          ? `${usd(amount)} demo started. OG B0T announced it in the signals chat.`
          : `${usd(amount)} demo started, but the announcement couldn't be posted.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the demo");
    } finally {
      setBusy(false);
      setConfirmDemo(false);
    }
  }

  return (
    <AdminSection
      icon={<RotateCcw className="h-4 w-4 text-amber-400" />}
      title="Signals chat: demo account"
      subtitle="Clears the signals chat, starts every counter from zero and the test account at the balance you set, then posts your Vantage invite and the test-mode note. All past trades are kept so the bot keeps learning from them."
    >
      {isLoading || !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-4 text-sm">
          {!data.ready ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
              The signals chat isn't set up yet (SIGNALS_BOT_TOKEN and SIGNALS_CHANNEL_ID).
            </p>
          ) : data.start != null ? (
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl border border-border p-3">
                <div className="text-xs text-muted-foreground">Started with</div>
                <div className="text-lg font-black text-foreground">{usd(data.start)}</div>
                {data.startedAt && (
                  <div className="text-xs text-muted-foreground">{when(data.startedAt)}</div>
                )}
              </div>
              <div
                className={`rounded-xl border p-3 ${
                  (data.balance ?? 0) >= data.start ? "border-emerald-500/40" : "border-rose-500/40"
                }`}
              >
                <div className="text-xs text-muted-foreground">Balance now</div>
                <div
                  className={`text-lg font-black ${
                    (data.balance ?? 0) >= data.start ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {usd(data.balance ?? data.start)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No test account running yet.</p>
          )}

          <div className="space-y-2">
            <label className="font-bold text-foreground" htmlFor="fresh-balance">
              New starting balance (USD)
            </label>
            <div className="flex gap-2">
              <Input
                id="fresh-balance"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
              <Button
                variant="destructive"
                disabled={busy || !valid || !data.ready}
                onClick={() => setConfirm(true)}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Purge & start"}
              </Button>
            </div>
            {data.start == null && (
              <Button
                className="w-full"
                disabled={busy || !valid || !data.ready}
                onClick={() => setConfirmDemo(true)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Start the ${valid ? usd(amount) : ""} demo, keep the chat and counter`
                )}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Telegram only lets bots delete messages from the last 48 hours; anything older stays
              until you remove it yourself.
            </p>
          </div>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Purge the signals chat and start fresh?</AlertDialogTitle>
            <AlertDialogDescription>
              The chat is cleared, the score and win rate go back to zero, and the test account
              restarts at {valid ? usd(amount) : "the new balance"}. Then your Vantage invite and
              the test-mode note go out. Past trades are kept for learning; they just stop counting
              in the chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void run()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Purge & start"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmDemo} onOpenChange={setConfirmDemo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start the {valid ? usd(amount) : ""} demo?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing is cleared: the chat and the win/loss counter stay as they are. From now on
              every alert is traded on the demo account, OG B0T posts its &quot;money where my mouth
              is&quot; announcement once, and the results at the bottom of the chat show the balance
              live.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void runDemo()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start the demo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminSection>
  );
}
