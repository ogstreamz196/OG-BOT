// A member's own OG SIGNAL BOT (website only): buy or renew the token, see
// whether their copier is running, get their token and config.ini (made fresh,
// shown once), download the copier and follow the setup, and pause new trades.
// The Boss pairs and manages keys in the Signals Control Room.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Copy, Download, KeyRound, Loader2, Pause, Play, ShoppingBag } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/copy-text";
import { getMyCopier, getMyCopierToken, setMyCopierPause } from "@/lib/copier-keys.functions";
import { TOKEN_PRODUCT_NAME } from "@/lib/copier-keys";
import { INVITE_LINK } from "@/lib/vantage-link";

const FILES = ["og_copier.py", "requirements.txt", "start_og_signal_bot.bat"] as const;

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MyCopierPage() {
  const load = useServerFn(getMyCopier);
  const pause = useServerFn(setMyCopierPause);
  const issue = useServerFn(getMyCopierToken);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["my-copier"],
    queryFn: () => load(),
    refetchInterval: 15_000,
  });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => pause({ data: { paused } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-copier"] }),
  });
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = useMutation({ mutationFn: () => issue() });
  const c = q.data?.copier ?? null;
  const made = token.data?.ok ? token.data : null;

  return (
    <DashboardShell title={TOKEN_PRODUCT_NAME}>
      <div className="mx-auto w-full max-w-xl space-y-4 p-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Bot className="h-6 w-6 text-emerald-400" /> OG SIGNAL BOT
        </h1>
        <p className="text-sm text-muted-foreground">
          Copies every OG B0T signal into your own MetaTrader 5 account, on your own PC or VPS. Lots
          are capped so one stop risks 2% of your balance at most (1% in high-frequency mode).
          Trading is risky; nothing here is financial advice.
        </p>

        {q.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : !c ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-foreground">
              You don&apos;t have an {TOKEN_PRODUCT_NAME} yet. Buy one in the store: it&apos;s tied
              to this account, and this page gives you your token and the setup.
            </p>
            <Button asChild className="w-full">
              <a href="/store">
                <ShoppingBag className="mr-2 h-4 w-4" /> Get the {TOKEN_PRODUCT_NAME}
              </a>
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 rounded-xl border border-border bg-card p-5">
              <p
                className={
                  c.state === "active"
                    ? c.daysLeft <= 3
                      ? "text-lg font-semibold text-amber-400"
                      : "text-lg font-semibold text-emerald-400"
                    : "text-lg font-semibold text-rose-400"
                }
              >
                {c.state === "off"
                  ? "Your access is switched off."
                  : c.state === "expired"
                    ? "Your access has run out."
                    : `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} of access left`}
              </p>
              {c.state === "active" && (
                <p className="text-sm text-muted-foreground">
                  Until {new Date(c.expiresAt).toLocaleDateString("en-GB")}
                </p>
              )}
              <Button asChild variant="secondary" className="w-full">
                <a href="/store">
                  <ShoppingBag className="mr-2 h-4 w-4" />
                  {c.state === "active" ? "Add more days" : "Renew in the store"}
                </a>
              </Button>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Your copier</dt>
                  <dd className={c.running ? "text-emerald-400" : "text-foreground"}>
                    {c.running ? "Running now" : c.lastSeen ? "Not running" : "Never started"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">MT5 account</dt>
                  <dd className="text-foreground">{c.account ?? "Not set up yet"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Balance last seen</dt>
                  <dd className="text-foreground">
                    {c.balance != null ? c.balance.toFixed(2) : "–"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">New trades</dt>
                  <dd className={c.paused ? "text-amber-400" : "text-foreground"}>
                    {c.paused ? "Paused by you" : "On"}
                  </dd>
                </div>
              </dl>

              {c.state === "active" && (
                <Button
                  className="w-full"
                  variant={c.paused ? "default" : "secondary"}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(!c.paused)}
                >
                  {toggle.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : c.paused ? (
                    <Play className="mr-2 h-4 w-4" />
                  ) : (
                    <Pause className="mr-2 h-4 w-4" />
                  )}
                  {c.paused ? "Resume new trades" : "Pause new trades"}
                </Button>
              )}
              {toggle.data && !toggle.data.ok && (
                <p className="text-sm text-rose-400">Couldn't save that. Try again in a minute.</p>
              )}
            </div>

            {c.state !== "off" && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                <h2 className="flex items-center gap-2 font-semibold text-foreground">
                  <KeyRound className="h-4 w-4 text-emerald-400" /> Your token
                </h2>
                {made ? (
                  <>
                    <p className="text-xs text-amber-400">
                      Shown once. Keep it private: it works on one PC and one MT5 account.
                    </p>
                    <code className="block break-all rounded-lg bg-muted p-3 text-xs text-foreground">
                      {made.token}
                    </code>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        onClick={async () => setCopied(await copyText(made.token))}
                      >
                        <Copy className="mr-2 h-4 w-4" /> {copied ? "Copied" : "Copy"}
                      </Button>
                      <Button onClick={() => saveFile("config.ini", made.config)}>
                        <Download className="mr-2 h-4 w-4" /> config.ini
                      </Button>
                    </div>
                  </>
                ) : confirming ? (
                  <>
                    <p className="text-sm text-foreground">
                      This makes a new token. Any copier using your old one stops until you put the
                      new one in.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" onClick={() => setConfirming(false)}>
                        Cancel
                      </Button>
                      <Button disabled={token.isPending} onClick={() => token.mutate()}>
                        {token.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Show my token
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button className="w-full" onClick={() => setConfirming(true)}>
                    <KeyRound className="mr-2 h-4 w-4" /> Get my token and config.ini
                  </Button>
                )}
                {token.data && !token.data.ok && (
                  <p className="text-sm text-rose-400">
                    Couldn&apos;t make a token. Try again in a minute.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-border bg-card p-5 text-sm">
              <h2 className="font-semibold text-foreground">Set it up (Windows PC or VPS)</h2>
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>
                  Open a Vantage account (a{" "}
                  <a
                    href={INVITE_LINK}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 underline"
                  >
                    demo first
                  </a>
                  ), install MetaTrader 5, log in, and turn on <b>Algo Trading</b>.
                </li>
                <li>
                  Install Python 3.12 (64-bit) from python.org and tick{" "}
                  <b>Add python.exe to PATH</b>.
                </li>
                <li>
                  Make a folder (e.g. <code>C:\og-signal-bot</code>) and save these into it, with
                  your <code>config.ini</code> from above:
                  <div className="mt-2 flex flex-wrap gap-2">
                    {FILES.map((f) => (
                      <a
                        key={f}
                        href={`/api/public/copier-files/${f}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                      >
                        <Download className="h-3 w-3" /> {f}
                      </a>
                    ))}
                  </div>
                </li>
                <li>
                  Double-click <code>start_og_signal_bot.bat</code>. It starts in practice mode (
                  <code>dry_run = true</code>): when you&apos;re happy, change it to{" "}
                  <code>false</code> in config.ini and start it again.
                </li>
                <li>
                  Leave it running with MT5 open. For 24/7 without your PC, use a Windows VPS (ask
                  Vantage about their free VPS offer).
                </li>
              </ol>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
