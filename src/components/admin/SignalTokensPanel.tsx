import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listSignalKeys,
  pairSignalKey,
  setSignalDownloadUrl,
  signalKeyAction,
} from "@/lib/signal-keys.functions";
import type { BossKeyRow } from "@/lib/copier-keys.server";
import { AdminSection } from "./AdminSection";

const KEY = ["boss", "signal-keys"] as const;
const DAY_CHOICES = [30, 90, 365];

const stateText = (r: BossKeyRow) =>
  r.state === "off"
    ? "Off"
    : r.state === "expired"
      ? "Ran out"
      : `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`;

/**
 * OG SIGNAL BOT tokens (the Boss, 2026-11-21: "pair user accounts to bot
 * tokens they can buy"). Every customer key: who it's paired with, days left,
 * whether their copier is running, and the actions. Bought tokens arrive here
 * by themselves (the store webhook); this is also where the Boss gives days
 * to an account or pairs a token made in Telegram. Members get the token on
 * their own OG SIGNAL BOT page (/copier).
 */
export function SignalTokensPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listSignalKeys);
  const act = useServerFn(signalKeyAction);
  const pair = useServerFn(pairSignalKey);
  const saveLink = useServerFn(setSignalDownloadUrl);
  const [link, setLink] = useState<string | null>(null);
  const link$ = useMutation({
    mutationFn: (url: string) => saveLink({ data: { url } }),
    onSuccess: (r) => {
      done(r);
      if (r.ok) setLink(null);
    },
    onError: () => toast.error("Couldn't save that. Try again."),
  });
  const q = useQuery({ queryKey: KEY, queryFn: () => list(), refetchInterval: 30_000 });
  const done = (r: { ok: boolean; message: string }) => {
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
    qc.invalidateQueries({ queryKey: KEY });
  };
  const action = useMutation({
    mutationFn: (v: {
      id: string;
      action: "extend" | "off" | "on" | "reset" | "remove";
      days?: number;
    }) => act({ data: v }),
    onSuccess: done,
    onError: () => toast.error("Couldn't save that. Try again."),
  });
  const give = useMutation({
    mutationFn: (v: { who: string; keyId?: string; days?: number }) => pair({ data: v }),
    onSuccess: (r) => {
      done(r);
      if (r.ok) {
        setWho("");
        setPairing(null);
      }
    },
    onError: () => toast.error("Couldn't save that. Try again."),
  });
  const [who, setWho] = useState("");
  const [days, setDays] = useState(30);
  const [pairing, setPairing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  const active = rows.filter((r) => r.state === "active").length;
  const running = rows.filter((r) => r.running).length;
  const busy = action.isPending || give.isPending;

  return (
    <AdminSection
      icon={<Bot className="h-5 w-5 text-emerald-400" />}
      title="OG SIGNAL BOT tokens"
      subtitle="Every customer's copier token. Store purchases land here by themselves; members get their token on their OG SIGNAL BOT page. Each token runs on one PC and one MT5 account."
      action={busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          <b>{active}</b> active · <b>{running}</b> running now · <b>{rows.length}</b> in total
        </p>

        <div className="rounded-lg border border-border bg-card/60 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {pairing ? "Pair this token with an account" : "Give days to an account"}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Their email or username"
              aria-label="Their email or username"
            />
            {!pairing && (
              <div className="flex gap-1">
                {DAY_CHOICES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays(d)}
                    aria-pressed={days === d}
                    className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                      days === d
                        ? "border-emerald-400/70 bg-emerald-500/15 text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            )}
            <Button
              disabled={busy || who.trim().length < 3}
              onClick={() => give.mutate(pairing ? { who, keyId: pairing } : { who, days })}
            >
              {pairing ? "Pair" : `Give ${days} days`}
            </Button>
            {pairing && (
              <Button variant="secondary" onClick={() => setPairing(null)}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/60 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Download link (the OG SIGNAL BOT zip)
          </p>
          <p className="mb-2 text-xs text-muted-foreground">
            Members get a Download button on their OG SIGNAL BOT page: unzip, open OGSignalBot.exe,
            sign in with their ogbot.co.uk login, Start. Leave it empty to show the Python setup
            instead.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={link ?? q.data?.download ?? ""}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://… (the zip on Cloudflare)"
              aria-label="Download link for the OG SIGNAL BOT zip"
            />
            <Button
              disabled={link$.isPending || link == null}
              onClick={() => link != null && link$.mutate(link)}
            >
              Save link
            </Button>
          </div>
        </div>

        {q.isError ? (
          <p className="text-sm text-rose-400">Couldn't load the tokens. Refresh to try again.</p>
        ) : q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tokens yet. They appear here as soon as someone buys the OG SIGNAL BOT TOKEN.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((r) => (
              <li key={r.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground">
                      {r.account?.label ?? r.name}
                    </span>{" "}
                    <span
                      className={
                        r.state === "active"
                          ? r.daysLeft <= 3
                            ? "text-amber-400"
                            : "text-emerald-400"
                          : "text-rose-400"
                      }
                    >
                      {stateText(r)}
                    </span>
                  </div>
                  <span
                    className={
                      r.running ? "text-xs text-emerald-400" : "text-xs text-muted-foreground"
                    }
                  >
                    {r.running ? "● Running" : r.lastSeen ? "Not running" : "Never started"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.account ? (
                    "Paired"
                  ) : (
                    <span className="text-amber-300">Not paired with an account</span>
                  )}
                  {r.mt5 ? ` · MT5 ${r.mt5}` : ""}
                  {r.balance != null ? ` · balance ${r.balance.toFixed(2)}` : ""}
                  {r.paused ? " · paused by them" : ""}
                  {r.locked ? " · locked to a machine" : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => action.mutate({ id: r.id, action: "extend", days: 30 })}
                  >
                    +30 days
                  </Button>
                  {r.state === "off" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => action.mutate({ id: r.id, action: "on" })}
                    >
                      Switch on
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => action.mutate({ id: r.id, action: "off" })}
                    >
                      Switch off
                    </Button>
                  )}
                  {r.locked && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => action.mutate({ id: r.id, action: "reset" })}
                      title="Lets them move to another PC or MT5 account"
                    >
                      Clear machine lock
                    </Button>
                  )}
                  {!r.account && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setPairing(r.id)}
                    >
                      <Link2 className="mr-1 h-3.5 w-3.5" /> Pair
                    </Button>
                  )}
                  {removing === r.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => {
                          setRemoving(null);
                          action.mutate({ id: r.id, action: "remove" });
                        }}
                      >
                        Yes, remove
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(r.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminSection>
  );
}
