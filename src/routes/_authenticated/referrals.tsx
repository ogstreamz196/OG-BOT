import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Check,
  Gift,
  Users,
  Coins,
  Share2,
  Link2,
  UserPlus,
  Sparkles,
  TrendingUp,
  Flame,
  Infinity as InfinityIcon,
  PiggyBank,
  CheckCircle2,
  Hourglass,
  QrCode,
  Download,
  KeyRound,
  Radio,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AllPurchasesPanel } from "@/components/admin/AllPurchasesPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BindReferrerCard } from "@/components/referrals/BindReferrerCard";
import { Lock, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/referrals")({
  component: ReferralsPage,
  head: () => ({
    meta: [
      { title: "Earn Dashboard | OG BOT — AI Songs & Diss Tracks" },
      {
        name: "description",
        content: "Track referral earnings, Community releases, and listening activity in OG BOT.",
      },
      { property: "og:title", content: "Earn Dashboard | OG BOT — AI Songs & Diss Tracks" },
      {
        property: "og:description",
        content: "Track referral earnings, Community releases, and listening activity in OG BOT.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Summary = {
  total_referred: number;
  total_earned: number;
  recent: {
    id: string;
    amount: number;
    type?:
      | "referral_cashback"
      | "referral_payment"
      | "referral_payment_reversal"
      | "referral_backpay";
    reference: string | null;
    created_at: string;
    referee_id: string | null;
    referee_name: string | null;
  }[];
};

async function copyTextWithFallback(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof document === "undefined") return false;
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function ReferralsPage() {
  const { user } = useAuth();
  // Cashback rate follows actual VIP status only (matches referral_rate_pct):
  // the 15-day introductory offer and free-access mode still earn 6%.
  const { hasVipRole, isAdmin, roles } = useRole();
  const isVip = hasVipRole || isAdmin || roles.includes("boss");
  const ratePct = isVip ? 13 : 6;
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const codeQ = useQuery({
    queryKey: ["my-referral-code", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.referral_code as string | null) ?? null;
    },
  });
  const myCode = codeQ.data ?? null;

  const publishedQ = useQuery({
    queryKey: ["earn-published-tracks", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from("songs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "completed")
        .eq("is_public", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const link = useMemo(() => {
    if (!user) return "";
    return `https://ogbot.co.uk/r/${myCode ?? user.id}`;
  }, [user, myCode]);

  const summaryQ = useQuery({
    queryKey: ["referral-summary", user?.id],
    enabled: !!user,
    // Earnings arrive instantly over realtime (below); this slower poll picks
    // up new sign-ups, which don't create a coin transaction.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await supabase.rpc("get_referral_summary");
      if (error) throw error;
      return (data ?? { total_referred: 0, total_earned: 0, recent: [] }) as Summary;
    },
  });

  const myRefQ = useQuery({
    queryKey: ["my-referrer", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_referrer");
      if (error) throw error;
      return data as {
        has_referrer: boolean;
        referrer_name?: string;
        referrer_code?: string;
        bound_at?: string;
      };
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`referrals-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "coin_transactions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { type?: string; amount?: number } | null;
          if (
            row?.type === "referral_cashback" ||
            row?.type === "referral_payment" ||
            row?.type === "referral_payment_reversal" ||
            row?.type === "referral_backpay"
          ) {
            qc.invalidateQueries({ queryKey: ["referral-summary", user.id] });
            qc.invalidateQueries({ queryKey: ["profile", user.id] });
            if (typeof row.amount === "number" && row.amount > 0) {
              toast.success(`+${row.amount} OG Coins referral reward`, {
                description:
                  row.type === "referral_backpay"
                    ? "Cashback you were owed has been paid back."
                    : row.type === "referral_payment"
                      ? "A referred member paid — your reward is in."
                      : "A referred member used coins — your share is in.",
              });
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "referrals",
          filter: `referrer_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["referral-summary", user.id] });
          toast.success("New referral signed up 🎉");
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  const handleCopy = async (label = "Referral link copied") => {
    const ok = await copyTextWithFallback(link);
    if (ok) {
      setCopied(true);
      toast.success(label);
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("Couldn't copy — long-press the link to copy it manually");
    }
  };

  const copy = () => handleCopy("Referral link copied");

  const share = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "Join OG Streamz",
          text: "Make AI songs on OG Streamz — sign up with my link and we both win:",
          url: link,
        });
        toast.success("Shared — thanks for spreading the word!");
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        toast.message("Share sheet unavailable — copying instead");
      }
    }
    await handleCopy("Link copied — paste it anywhere to share");
  };

  const summary = summaryQ.data ?? { total_referred: 0, total_earned: 0, recent: [] };
  const shortLink = link.replace(/^https?:\/\//, "");

  // Paid vs pending breakdown.
  // Reward rows are credited after a referred member pays or uses coins.
  const paidCoins = summary.total_earned;
  const paidEvents = summary.recent.length;
  const paidRefereeIds = new Set(
    summary.recent.map((r) => r.referee_id).filter((id): id is string => !!id),
  );
  const pendingReferees = Math.max(0, summary.total_referred - paidRefereeIds.size);

  const downloadQR = (svgId: string, filename: string) => {
    if (typeof document === "undefined") return;
    const svg = document.getElementById(svgId) as SVGSVGElement | null;
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("QR code saved");
  };

  return (
    <DashboardShell title="Earnings">
      <div className="relative w-full space-y-4 sm:space-y-6" data-testid="referrals-page">
        {/* Ambient atmosphere */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute top-1/4 -left-20 h-96 w-96 rounded-full bg-primary/10 blur-[120px]" />
          <div className="absolute bottom-1/4 -right-20 h-96 w-96 rounded-full bg-destructive/10 blur-[120px]" />
        </div>

        {/* Status strip — live + binding state, one row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-card/70 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.2em] text-destructive backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" /> Live
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.2em] text-black shadow-lg shadow-orange-900/30">
            <Sparkles className="h-3 w-3" /> {ratePct}% Lifetime{isVip ? " · VIP" : ""}
          </span>
          {myRefQ.data?.has_referrer ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.2em] text-emerald-300">
              <Lock className="h-3 w-3" /> Bound · {myRefQ.data.referrer_name}
            </span>
          ) : (
            <button
              onClick={() =>
                document.getElementById("bind-referrer")?.scrollIntoView({ behavior: "smooth" })
              }
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-amber-200 shadow-lg transition hover:bg-amber-500/30 sm:w-auto"
            >
              <ShieldAlert className="h-4 w-4" /> Got invited? Tap here to bind your OG Leader →
            </button>
          )}
        </div>

        {/* 1. HOW IT WORKS — the deal, stated once */}
        <section
          data-testid="earn-scheme"
          className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card/70 p-5 backdrop-blur-2xl sm:p-8"
        >
          <p className="text-[0.7rem] font-black uppercase tracking-[0.25em] text-amber-300">
            OG Partner Scheme
          </p>
          <h2 className="mt-2 font-bungee text-2xl leading-tight sm:text-4xl">
            Get {ratePct}% of every coin your friends spend — forever.
            {!isVip && (
              <span className="mt-1 block text-sm font-sans font-bold text-amber-300">
                OG VIPs earn 13% — upgrade to boost your cut.
              </span>
            )}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Mission
              tone="primary"
              n={1}
              icon={<Link2 className="h-5 w-5" />}
              title={
                <button
                  type="button"
                  onClick={() => {
                    document
                      .querySelector('[data-testid="share-hub"]')
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    void handleCopy("Link copied — paste it anywhere to share");
                  }}
                  className="text-left underline decoration-primary/60 underline-offset-4 hover:text-primary"
                >
                  Share your link
                </button>
              }
              body="Tap above to copy your link. Or let them scan your QR."
            />
            <Mission
              tone="fuchsia"
              n={2}
              icon={<UserPlus className="h-5 w-5" />}
              title="They join & make songs"
              body="They're linked to you for life."
            />
            <Mission
              tone="destructive"
              n={3}
              icon={<Flame className="h-5 w-5" />}
              title={`You earn ${ratePct}%`}
              body="Paid automatically in OG Coins. No limit, no expiry."
            />
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PiggyBank className="h-3.5 w-3.5 text-amber-300" />
            Example: a friend uses 100 coins → you get +{ratePct} OG{isVip ? "" : " (+13 as VIP)"}.
          </p>
        </section>

        {/* 2. SHARE HUB — the only place to share */}
        <section
          data-testid="share-hub"
          className="rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl sm:p-6"
        >
          <div className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-primary">
            Your invite
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="space-y-3">
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  readOnly
                  value={shortLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-11 pl-9 font-mono text-xs sm:text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={share}
                  className="h-11 gap-2 bg-gradient-to-r from-primary to-fuchsia-500 font-black uppercase tracking-wider"
                >
                  <Share2 className="h-4 w-4" /> Share
                </Button>
                <Button onClick={copy} variant="secondary" className="h-11 gap-2 font-bold">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
              {user && (
                <div className="flex items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      Or they can enter your code
                    </div>
                    <div className="font-mono text-lg font-black tracking-widest">
                      {codeQ.isLoading ? "Loading…" : (myCode ?? "—")}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!myCode}
                    onClick={async () => {
                      if (!myCode) return;
                      const ok = await copyTextWithFallback(myCode);
                      if (ok) toast.success(`Code ${myCode} copied`);
                      else toast.error("Couldn't copy");
                    }}
                    className="h-8 gap-1.5 px-2 text-xs"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
              )}
            </div>

            {link && (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-background/60 p-3 md:w-44">
                <div className="rounded-xl bg-white p-2.5">
                  <QRCodeSVG
                    id="og-referral-qr"
                    value={link}
                    size={128}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadQR("og-referral-qr", "og-referral-qr.svg")}
                  className="h-7 gap-1.5 px-2 text-xs"
                >
                  <Download className="h-3 w-3" /> Save QR
                </Button>
              </div>
            )}
          </div>

          {myCode && (
            <div className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/5 p-3">
              <p className="text-xs font-black uppercase tracking-wider text-amber-300">
                How friends bind you as their OG Leader
              </p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                <li>Open your link above (or scan your QR) and sign up — done automatically.</li>
                <li>
                  Already signed up? Go to the <b>Earn</b> tab, tap “Bind your OG Leader” and enter{" "}
                  <b className="text-foreground">{myCode}</b>.
                </li>
              </ol>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2 h-8 gap-1.5 text-xs"
                onClick={async () => {
                  const msg = `Join me on OG Streamz to make AI music! Sign up with my link ${link} — or open the Earn tab, tap "Bind your OG Leader" and enter my code ${myCode}.`;
                  const ok = await copyTextWithFallback(msg);
                  if (ok) toast.success("Invite message copied");
                  else toast.error("Couldn't copy");
                }}
              >
                <Copy className="h-3 w-3" /> Copy invite message
              </Button>
            </div>
          )}
        </section>

        {/* 3. YOUR NUMBERS — one row */}
        <section
          data-testid="referrals-stat-tiles"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <StatTile
            tone="emerald"
            icon={<Coins className="h-4 w-4" />}
            label="Earned"
            value={paidCoins.toLocaleString()}
            sub={`${paidEvents} ${paidEvents === 1 ? "reward" : "rewards"}`}
            unit="OG"
          />
          <StatTile
            tone="sky"
            icon={<Users className="h-4 w-4" />}
            label="Friends"
            value={summary.total_referred.toLocaleString()}
            sub="Joined with your link"
            unit=""
          />
          <StatTile
            tone="amber"
            icon={<Hourglass className="h-4 w-4" />}
            label="Waiting"
            value={pendingReferees.toLocaleString()}
            sub="Not spent coins yet"
            unit=""
          />
          <StatTile
            tone="sky"
            icon={<Radio className="h-4 w-4" />}
            label="Your tracks"
            value={publishedQ.isLoading ? "—" : (publishedQ.data ?? 0).toLocaleString()}
            sub="Live in Community"
            unit=""
          />
        </section>

        {/* CASHBACK FEED — dense activity */}
        <section
          data-testid="referrals-cashback-feed"
          className="rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl sm:p-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-bungee text-xl tracking-tight">Cashback feed</h2>
            <span className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-muted-foreground">
              Last 20
            </span>
          </div>
          <div className="mt-3 divide-y divide-white/5">
            {summaryQ.isLoading && (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
            )}
            {!summaryQ.isLoading && summary.recent.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
                  <Coins className="h-6 w-6" />
                </div>
                <div className="text-sm font-bold">No cashback yet</div>
                <div className="max-w-xs text-xs text-muted-foreground">
                  When a friend you invited spends coins, your reward shows up here.
                </div>
              </div>
            )}
            {summary.recent.map((tx) => {
              const burned = Number(tx.reference?.match(/burn:(\d+)/)?.[1] ?? 0);
              const isPayment = tx.type === "referral_payment";
              const isReversal = tx.type === "referral_payment_reversal";
              const isBackpay = tx.type === "referral_backpay";
              const when = new Date(tx.created_at);
              return (
                <div key={tx.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-black uppercase text-primary">
                      {(tx.referee_name ?? "?").slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate text-sm font-bold">
                        {isBackpay ? "OG Bot" : (tx.referee_name ?? "Referred user")}
                        {isReversal ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[0.7rem] font-black uppercase tracking-[0.16em] text-amber-300">
                            Refunded
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[0.7rem] font-black uppercase tracking-[0.16em] text-emerald-300">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Paid
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {isBackpay ? (
                          <>Cashback you were owed, paid back = </>
                        ) : isReversal ? (
                          <>Payment refunded, reward reversed = </>
                        ) : isPayment ? (
                          <>Successful payment reward = </>
                        ) : burned > 0 ? (
                          <>{burned} used → </>
                        ) : (
                          <>Cashback = </>
                        )}
                        <span className="font-bold text-primary">
                          {tx.amount >= 0 ? `+${tx.amount}` : `−${Math.abs(tx.amount)}`} OG
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[0.7rem] text-muted-foreground">
                    <div>{when.toLocaleDateString()}</div>
                    <div>{when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 5. CONNECT YOUR LEADER — for people invited by someone else */}
        <section
          id="bind-referrer"
          className="scroll-mt-24 rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl sm:p-6"
        >
          <div className="mb-3 flex items-center gap-2 text-[0.7rem] font-black uppercase tracking-[0.22em] text-rose-300">
            <KeyRound className="h-3.5 w-3.5" /> Were you invited? Connect your OG Leader
          </div>
          <BindReferrerCard />
        </section>

        <AllPurchasesPanel />
      </div>
    </DashboardShell>
  );
}

function StatTile({
  tone,
  icon,
  label,
  value,
  sub,
  unit,
}: {
  tone: "emerald" | "amber" | "sky";
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  unit: string;
}) {
  const tones = {
    emerald: {
      ring: "hover:border-emerald-400/40",
      text: "text-emerald-400",
      glow: "from-emerald-500/20",
    },
    amber: { ring: "hover:border-amber-400/40", text: "text-amber-400", glow: "from-amber-500/20" },
    sky: { ring: "hover:border-sky-400/40", text: "text-sky-400", glow: "from-sky-500/20" },
  }[tone];
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-card/70 p-5 backdrop-blur-xl transition ${tones.ring}`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${tones.glow} to-transparent blur-2xl`}
      />
      <div className="relative flex items-start justify-between">
        <span
          className={`inline-flex items-center gap-1.5 text-[0.7rem] font-black uppercase tracking-[0.22em] ${tones.text}`}
        >
          {icon} {label}
        </span>
        <span className="text-[0.7rem] font-black uppercase tracking-widest text-muted-foreground">
          {unit}
        </span>
      </div>
      <div className="relative mt-3 font-bungee text-4xl tabular-nums">{value}</div>
      <div className="relative mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function DashboardMetric({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone: "primary" | "emerald" | "sky" | "amber";
}) {
  const tones = {
    primary: "bg-primary/15 text-primary",
    emerald: "bg-emerald-500/15 text-emerald-300",
    sky: "bg-sky-500/15 text-sky-300",
    amber: "bg-amber-500/15 text-amber-300",
  }[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-card/70 p-3.5 backdrop-blur-xl sm:p-4">
      <div className={`grid h-9 w-9 place-items-center rounded-lg ${tones}`}>{icon}</div>
      <p className="mt-3 break-words text-[0.7rem] font-black uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words font-bungee text-2xl tabular-nums leading-tight sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Mission({
  tone,
  n,
  icon,
  title,
  body,
}: {
  tone: "primary" | "fuchsia" | "destructive";
  n: number;
  icon: React.ReactNode;
  title: ReactNode;
  body: string;
}) {
  const tones = {
    primary: { ring: "hover:border-primary/40", bg: "bg-primary/10", text: "text-primary" },
    fuchsia: {
      ring: "hover:border-fuchsia-400/40",
      bg: "bg-fuchsia-500/10",
      text: "text-fuchsia-400",
    },
    destructive: {
      ring: "hover:border-destructive/40",
      bg: "bg-destructive/10",
      text: "text-destructive",
    },
  }[tone];
  return (
    <div
      className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl transition ${tones.ring}`}
    >
      <div className="absolute right-3 top-2 font-bungee text-6xl text-white/[0.04]">{n}</div>
      <div className="relative">
        <div className={`grid h-11 w-11 place-items-center rounded-xl ${tones.bg} ${tones.text}`}>
          {icon}
        </div>
        <div className="mt-3 text-base font-black">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
