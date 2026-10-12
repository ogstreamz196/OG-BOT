import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Search,
  Lock,
  CheckCircle2,
  Skull,
  Loader2,
  RefreshCw,
  WifiOff,
  Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^OG-[A-Z0-9]{6}$/i;

type LookupResult = { id: string; name: string; code?: string | null };
type LookupKind = "uuid" | "code" | "link" | null;

function classify(raw: string): { kind: LookupKind; value: string } {
  const t = raw.trim();
  if (!t) return { kind: null, value: "" };
  if (UUID_RE.test(t)) return { kind: "uuid", value: t.toLowerCase() };
  const linkUuid = t.match(/\/r\/([0-9a-f-]{36})/i)?.[1];
  if (linkUuid) return { kind: "link", value: linkUuid.toLowerCase() };
  const linkCode = t.match(/\/r\/((?:OG-)?[A-Z0-9]{3,32})/i)?.[1];
  if (linkCode) return { kind: "code", value: linkCode.toUpperCase() };
  // bare code: legacy OG-XXXXXX, OG VIP ID (OGNAME123) or username
  const cleaned = t.toUpperCase().replace(/\s+/g, "");
  if (CODE_RE.test(cleaned)) return { kind: "code", value: cleaned };
  if (/^(?:OG-)?[A-Z0-9]{3,32}$/.test(cleaned)) return { kind: "code", value: cleaned };
  return { kind: null, value: t };
}

function formatBound(ts?: string | null) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
}

export function BindReferrerCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [ack, setAck] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [bindErr, setBindErr] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);

  const mineQ = useQuery({
    queryKey: ["my-referrer", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_referrer");
      if (error) throw error;
      return data as {
        has_referrer: boolean;
        referrer_id?: string;
        referrer_name?: string;
        referrer_code?: string;
        bound_at?: string;
      };
    },
  });

  useEffect(() => {
    setAck(false);
    setBindErr(null);
  }, [lookup?.id]);

  if (mineQ.isLoading) {
    return (
      <section className="rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your referrer status…
        </div>
      </section>
    );
  }

  if (mineQ.data?.has_referrer) {
    const code = mineQ.data.referrer_code;
    const id = mineQ.data.referrer_id;
    return (
      <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-5 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-300">
              Locked to your OG Leader
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                Permanent
              </span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{mineQ.data.referrer_name}</span> now
              owns your life in their hands. They earn up to 13% of every OG Coin you burn — forever.
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {code && (
                <div className="rounded-lg border border-white/10 bg-background/60 p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    OG Leader code
                  </div>
                  <div className="mt-0.5 font-mono text-sm">{code}</div>
                </div>
              )}
              {mineQ.data.bound_at && (
                <div className="rounded-lg border border-white/10 bg-background/60 p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Bound on
                  </div>
                  <div className="mt-0.5 text-sm">{formatBound(mineQ.data.bound_at)}</div>
                </div>
              )}
              {id && (
                <div className="rounded-lg border border-white/10 bg-background/60 p-2.5 sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Leader ID
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[10px]"
                      onClick={() => {
                        navigator.clipboard?.writeText(id);
                        toast.success("Leader ID copied");
                      }}
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  </div>
                  <div className="mt-0.5 break-all font-mono text-xs">{id}</div>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {code && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 gap-1.5"
                  onClick={() => {
                    const url = `https://ogbot.co.uk/r/${code}`;
                    navigator.clipboard?.writeText(url);
                    toast.success("Referrer link copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy referrer link
                </Button>
              )}
              {id && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5"
                  onClick={() => {
                    navigator.clipboard?.writeText(id);
                    toast.success("Leader ID copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy Leader ID
                </Button>
              )}
            </div>
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-200">
              This bond is permanent — it cannot be changed, swapped, or reset by anyone, ever.
            </div>
          </div>
        </div>
      </section>
    );
  }

  const parsed = classify(input);
  const canLookup = parsed.kind !== null && !lookupBusy;

  const runLookup = async () => {
    setLookupErr(null);
    setLookup(null);
    if (!parsed.kind) {
      setLookupErr("Paste a valid OG referral code (OG-XXXXXX), ID, or link.");
      return;
    }
    if (user && parsed.value === user.id) {
      setLookupErr("That's your own ID — you can't refer yourself.");
      return;
    }
    setLookupBusy(true);
    try {
      const rpc =
        parsed.kind === "code"
          ? supabase.rpc("lookup_referrer_by_code", { p_code: parsed.value })
          : supabase.rpc("lookup_referrer", { p_referrer: parsed.value });
      const { data, error } = await rpc;
      if (error) throw error;
      const r = data as {
        found: boolean;
        referrer_id?: string;
        referrer_name?: string;
        referrer_code?: string;
      };
      if (!r.found) {
        setLookupErr(
          parsed.kind === "code"
            ? `No OG Leader found for code "${parsed.value}". Double-check the code with your inviter.`
            : "No OG Leader found for that ID/link. Ask your inviter to share their OG Leader code from their Earnings page.",
        );
        return;
      }
      if (user && r.referrer_id === user.id) {
        setLookupErr("That's your own profile — you can't refer yourself.");
        return;
      }
      setLookup({ id: r.referrer_id!, name: r.referrer_name!, code: r.referrer_code });
    } catch (e) {
      const msg = String((e as Error)?.message ?? "");
      if (msg.toLowerCase().includes("network") || msg.includes("Failed to fetch")) {
        setLookupErr("Network error. Check your connection and try again.");
      } else {
        setLookupErr(msg || "Lookup failed. Try again in a moment.");
      }
    } finally {
      setLookupBusy(false);
    }
  };

  const bind = async () => {
    if (!lookup || !ack) return;
    setBindErr(null);
    setBindBusy(true);
    try {
      const { error } = await supabase.rpc("claim_referrer_permanent", {
        p_referrer: lookup.id,
        p_acknowledged: true,
      });
      if (error) throw error;
      toast.success(`Bound to ${lookup.name} — forever.`);
      qc.invalidateQueries({ queryKey: ["my-referrer", user?.id] });
    } catch (e) {
      const raw = String((e as Error)?.message ?? "");
      let friendly = "Could not bind referrer. Please try again.";
      if (raw.includes("already_has_referrer")) {
        friendly = "You already have a referrer locked. This is permanent and can't be changed.";
        qc.invalidateQueries({ queryKey: ["my-referrer", user?.id] });
      } else if (raw.includes("referrer_not_found")) {
        friendly = "That OG Leader no longer exists. Ask your inviter for a fresh code.";
      } else if (raw.includes("invalid_referrer")) {
        friendly = "Invalid referrer. You can't bind to yourself.";
      } else if (raw.includes("acknowledgement_required")) {
        friendly = "Tick the acknowledgement box to confirm this permanent bond.";
      } else if (raw.includes("not_authenticated")) {
        friendly = "Your session expired. Sign in again to lock your OG Leader.";
      } else if (raw.toLowerCase().includes("network") || raw.includes("Failed to fetch")) {
        friendly = "Network error — your binding was NOT saved. Check your connection and retry.";
      }
      setBindErr(friendly);
    } finally {
      setBindBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-card/70 p-5 backdrop-blur-xl sm:p-6">
      <div className="mb-3 flex items-center gap-2">
        <Skull className="h-5 w-5 text-rose-400" />
        <h2 className="font-display text-lg font-bold">Bind your OG Leader (one-time, forever)</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Paste the <span className="font-semibold text-foreground">OG Leader code</span> (
        <span className="font-mono">OG-XXXXXX</span>), ID, or referral link of the person who
        brought you in. Once locked, up to 13% of every OG Coin you ever burn goes to their OG Vault —
        automatically, for life. You can only do this once.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          id="og-leader-code-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setLookup(null);
            setLookupErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canLookup) runLookup();
          }}
          placeholder="OG-XXXXXX, referrer ID, or referral link"
          className="flex-1 font-mono text-xs sm:text-sm"
          aria-invalid={!!lookupErr}
        />
        <Button onClick={runLookup} disabled={!canLookup} variant="secondary" className="gap-2">
          {lookupBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {lookupBusy ? "Looking up…" : "Find OG Leader"}
        </Button>
      </div>

      {input.trim() && !lookup && !lookupErr && !lookupBusy && parsed.kind === null && (
        <p className="mt-2 text-xs text-amber-300">
          That doesn't look like a code (OG-XXXXXX), ID, or referral link.
        </p>
      )}

      {lookupErr && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div>{lookupErr}</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={runLookup}
              disabled={!canLookup}
              className="mt-2 h-7 gap-1.5 px-2 text-rose-200 hover:bg-rose-500/20"
            >
              <RefreshCw className="h-3 w-3" /> Try again
            </Button>
          </div>
        </div>
      )}

      {lookup && (
        <div className="mt-4 space-y-3 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            <div className="text-sm">
              <div className="font-semibold text-rose-300">Heavy warning — read carefully</div>
              <p className="mt-1 text-muted-foreground">
                You're about to hand{" "}
                <span className="font-semibold text-foreground">{lookup.name}</span>
                {lookup.code ? (
                  <>
                    {" "}
                    (<span className="font-mono text-foreground">{lookup.code}</span>)
                  </>
                ) : null}{" "}
                the keys. They now own your life in their hands — they can rinse you completely.{" "}
                <span className="font-semibold text-foreground">up to 13% of every OG Coin</span> you burn
                from this moment on flows into{" "}
                <span className="font-semibold">{lookup.name}'s</span> OG Vault. This decision is
                permanent. It cannot be undone, swapped, or reset by anyone, ever.
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/10 bg-background/40 p-3 text-sm">
            <Checkbox
              checked={ack}
              onCheckedChange={(v) => setAck(v === true)}
              className="mt-0.5"
            />
            <span>
              I understand. {lookup.name} now owns my life in their hands and earns up to 13% of every OG
              Coin I burn — forever.
            </span>
          </label>

          {bindErr && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
              {bindErr.toLowerCase().includes("network") ? (
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="flex-1">
                <div>{bindErr}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={bind}
                  disabled={!ack || bindBusy}
                  className="mt-2 h-7 gap-1.5 px-2 text-rose-200 hover:bg-rose-500/20"
                >
                  <RefreshCw className="h-3 w-3" /> Retry binding
                </Button>
              </div>
            </div>
          )}

          <Button onClick={bind} disabled={!ack || bindBusy} className="w-full gap-2">
            {bindBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Locking forever…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Lock {lookup.name} as my OG Leader — forever
              </>
            )}
          </Button>
        </div>
      )}
    </section>
  );
}
