// A member's own OG SIGNAL BOT (website only): buy 30-day passes right here
// (as many as they like, each on top of their expiry; claimed free while the
// pass is free), see whether their copier is running and pause new trades,
// download the app (the zip the Boss links in the Control Room: unzip, open
// OGCopier.exe, sign in, Start), or set the Python copier up with their token
// and a ready config.ini.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { StripeCheckoutDialog } from "@/components/payments/StripeCheckoutDialog";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/copy-text";
import {
  claimFreeSignalToken,
  getMyCopier,
  getMyCopierToken,
  setMyCopierPause,
} from "@/lib/copier-keys.functions";
import { createStoreItemCheckoutSession } from "@/lib/store.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { INVITE_LINK } from "@/lib/vantage-link";

const FILES = ["og_copier.py", "requirements.txt", "start_og_signal_bot.bat"] as const;
const MAX_PASSES = 12;

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

export function MyCopierPage() {
  const load = useServerFn(getMyCopier);
  const pause = useServerFn(setMyCopierPause);
  const issue = useServerFn(getMyCopierToken);
  const claim = useServerFn(claimFreeSignalToken);
  const checkout = useServerFn(createStoreItemCheckoutSession);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["my-copier"],
    queryFn: () => load(),
    refetchInterval: 15_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-copier"] });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => pause({ data: { paused } }),
    onSuccess: refresh,
  });
  const [passes, setPasses] = useState(1);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const buy = useMutation({
    mutationFn: async () => {
      const pass = q.data?.pass;
      if (!pass) throw new Error("The OG SIGNAL BOT isn't on sale right now.");
      if (pass.free) return { kind: "free" as const, claimed: await claim() };
      const returnUrl = `${window.location.origin}/buy-coins/return?session_id={CHECKOUT_SESSION_ID}`;
      const r = await checkout({
        data: {
          itemId: pass.itemId,
          returnUrl,
          environment: getStripeEnvironment(),
          quantity: passes,
        },
      });
      if ("error" in r) throw new Error(r.error);
      return { kind: "card" as const, clientSecret: r.clientSecret };
    },
    onSuccess: (r) => {
      if (r.kind === "free") {
        if (r.claimed.ok) toast.success(r.claimed.message);
        else toast(r.claimed.message);
        refresh();
      } else setClientSecret(r.clientSecret);
    },
    onError: (e: Error) => toast.error(e.message || "Checkout could not start."),
  });
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = useMutation({ mutationFn: () => issue() });
  const c = q.data?.copier ?? null;
  const pass = q.data?.pass ?? null;
  const download = q.data?.download ?? null;
  const made = token.data?.ok ? token.data : null;
  const total = useMemo(
    () => (pass && !pass.free ? money(pass.priceCents * passes, pass.currency) : null),
    [pass, passes],
  );

  const passBox = pass ? (
    <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-foreground">
        <ShoppingBag className="h-4 w-4 text-emerald-400" />
        {pass.free ? `${pass.days} days FREE (for a limited time)` : `${pass.days}-day passes`}
      </h2>
      {pass.free ? (
        <p className="text-sm text-muted-foreground">
          Claim {pass.days} days on the house. You can claim again when 3 days or fewer are left.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {money(pass.priceCents, pass.currency)} per {pass.days} days. Buy as many as you like:
            each pass adds {pass.days} days on top of what you have left.
          </p>
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="secondary"
              aria-label="One pass fewer"
              disabled={passes <= 1}
              onClick={() => setPasses((n) => Math.max(1, n - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-[7rem] text-center text-sm font-semibold text-foreground">
              {passes} × {pass.days} days = {passes * pass.days} days
            </span>
            <Button
              size="icon"
              variant="secondary"
              aria-label="One pass more"
              disabled={passes >= MAX_PASSES}
              onClick={() => setPasses((n) => Math.min(MAX_PASSES, n + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
      <Button className="w-full" disabled={buy.isPending} onClick={() => buy.mutate()}>
        {buy.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pass.free ? `Claim ${pass.days} days free` : `Buy ${passes * pass.days} days · ${total}`}
      </Button>
    </div>
  ) : null;

  const tokenBox =
    c && c.state !== "off" ? (
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-emerald-400" /> Your token and config.ini
        </h3>
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
            <p className="text-xs text-muted-foreground">
              config.ini is ready as it is (your token is in it): nothing to edit.
            </p>
          </>
        ) : confirming ? (
          <>
            <p className="text-sm text-foreground">
              This makes a new token. Any copier using your old one stops until it has the new one.
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
          <Button className="w-full" variant="secondary" onClick={() => setConfirming(true)}>
            <KeyRound className="mr-2 h-4 w-4" /> Get my token and config.ini
          </Button>
        )}
        {token.data && !token.data.ok && (
          <p className="text-sm text-rose-400">
            Couldn&apos;t make a token. Try again in a minute.
          </p>
        )}
      </div>
    ) : null;

  const pythonSetup = (
    <div className="space-y-3 text-sm">
      {tokenBox}
      <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>
          Install MetaTrader 5, log in (a demo account first) and turn on <b>Algo Trading</b>.
        </li>
        <li>
          Install Python 3.12 (64-bit) from python.org and tick <b>Add python.exe to PATH</b>.
        </li>
        <li>
          Put these in one folder with your <code>config.ini</code>:
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
          Double-click <code>start_og_signal_bot.bat</code>. It trades on whichever MT5 account is
          logged in.
        </li>
      </ol>
    </div>
  );

  return (
    <DashboardShell title="OG SIGNAL BOT">
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
        ) : (
          <>
            {c && (
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
                  <p className="text-sm text-rose-400">
                    Couldn&apos;t save that. Try again in a minute.
                  </p>
                )}
              </div>
            )}

            {c?.state === "off" ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-foreground">
                Your token is switched off. Message the Boss to get it back on.
              </p>
            ) : passBox ? (
              passBox
            ) : (
              !c && (
                <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  The OG SIGNAL BOT isn&apos;t on sale right now. Check back soon.
                </p>
              )
            )}

            {c && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-5 text-sm">
                <h2 className="font-semibold text-foreground">Set it up (Windows PC or VPS)</h2>
                {download ? (
                  <>
                    <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                      <li>
                        <a
                          href={download}
                          className="inline-flex items-center gap-1 font-semibold text-emerald-400 underline"
                        >
                          <Download className="h-4 w-4" /> Download OG SIGNAL BOT for Windows
                        </a>{" "}
                        and unzip it (right-click → Extract All).
                      </li>
                      <li>
                        Open <b>OGCopier.exe</b> and sign in with your ogbot.co.uk username and
                        password.
                      </li>
                      <li>
                        Press <b>Start</b>. The first time, it asks for your MT5 login (a{" "}
                        <a
                          href={INVITE_LINK}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 underline"
                        >
                          Vantage
                        </a>{" "}
                        account; a demo first). That&apos;s it.
                      </li>
                    </ol>
                    <details className="rounded-lg border border-border p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                        Advanced: run it with Python instead
                      </summary>
                      <div className="mt-3">{pythonSetup}</div>
                    </details>
                  </>
                ) : (
                  pythonSetup
                )}
                <p className="text-xs text-muted-foreground">
                  Leave it running with MT5 open. For 24/7 without your PC, use a Windows VPS (ask
                  Vantage about their free VPS offer).
                </p>
              </div>
            )}
          </>
        )}
      </div>
      <StripeCheckoutDialog
        clientSecret={clientSecret}
        onClose={() => {
          setClientSecret(null);
          refresh();
        }}
      />
    </DashboardShell>
  );
}
