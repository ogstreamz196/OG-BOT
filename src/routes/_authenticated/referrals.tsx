import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
      { title: "Earn Dashboard | OG BOT" },
      {
        name: "description",
        content: "Track referral earnings, Global releases, and listening activity in OG BOT.",
      },
      { property: "og:title", content: "Earn Dashboard | OG BOT" },
      {
        property: "og:description",
        content: "Track referral earnings, Global releases, and listening activity in OG BOT.",
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
    type?: "referral_cashback" | "referral_payment";
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
    refetchInterval: 15_000,
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
          if (row?.type === "referral_cashback" || row?.type === "referral_payment") {
            qc.invalidateQueries({ queryKey: ["referral-summary", user.id] });
            qc.invalidateQueries({ queryKey: ["profile", user.id] });
            if (typeof row.amount === "number" && row.amount > 0) {
              toast.success(`+${row.amount} OG Coins referral reward`, {
                description:
                  row.type === "referral_payment"
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
  const inviteAgain = () => handleCopy("Link copied — paste it to invite again 🎁");

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
            <Sparkles className="h-3 w-3" /> 10% Lifetime
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
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[0.7rem] font-black uppercase tracking-[0.2em] text-amber-300 transition hover:bg-amber-500/20"
            >
              <ShieldAlert className="h-3 w-3" /> Bind your OG Leader
            </button>
          )}
        </div>

        <section aria-label="Earn dashboard" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DashboardMetric
            icon={<Coins className="h-4 w-4" />}
            label="Referral earnings"
            value={`${summary.total_earned.toLocaleString()} OG`}
            note="Paid referrals + coin use"
            tone="primary"
          />
          <DashboardMetric
            icon={<Users className="h-4 w-4" />}
            label="Your network"
            value={summary.total_referred.toLocaleString()}
            note="Referred members"
            tone="emerald"
          />
          <DashboardMetric
            icon={<Radio className="h-4 w-4" />}
            label="Published tracks"
            value={publishedQ.isLoading ? "—" : (publishedQ.data ?? 0).toLocaleString()}
            note="Live in Global"
            tone="sky"
          />
        </section>

        {/* HERO — oversized wallet counter */}
        <section
          data-testid="referrals-hero"
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-2xl sm:p-10"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-10 -bottom-10 h-48 w-48 rounded-full bg-destructive/15 blur-3xl"
          />

          <div className="relative text-center">
            <p className="mb-2 text-[0.7rem] font-black uppercase tracking-[0.3em] text-muted-foreground sm:mb-3 sm:tracking-[0.4em]">
              OG Coin Cashback Wallet
            </p>
            <div className="relative inline-block max-w-full">
              <div
                aria-hidden
                className="absolute -inset-2 rounded-3xl bg-gradient-to-r from-primary via-fuchsia-500 to-destructive opacity-25 blur-2xl"
              />
              <div className="relative flex items-baseline justify-center gap-2 sm:gap-3">
                <span className="font-bungee bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-6xl font-black tabular-nums tracking-tight text-transparent drop-shadow-[0_4px_24px_rgba(239,68,68,0.35)] sm:text-8xl">
                  {summary.total_earned.toLocaleString()}
                </span>
                <span className="text-base font-black uppercase tracking-widest text-primary sm:text-2xl">
                  OG
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs sm:mt-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-300">
                <TrendingUp className="h-3 w-3" /> {summary.total_referred}{" "}
                {summary.total_referred === 1 ? "referral" : "referrals"} · auto-paid
              </span>
              <span className="text-muted-foreground">
                Rewards from their payments and coin use
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:mt-6 sm:flex-row sm:flex-wrap sm:justify-center">
              <Button
                onClick={share}
                size="lg"
                className="h-12 w-full gap-2 bg-gradient-to-r from-primary to-fuchsia-500 px-6 font-black uppercase tracking-wider shadow-glow hover:scale-[1.02] sm:w-auto"
              >
                <Share2 className="h-4 w-4" /> Share & earn
              </Button>
              <Button
                onClick={copy}
                variant="secondary"
                size="lg"
                className="h-12 w-full gap-2 font-bold uppercase tracking-wider sm:w-auto"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </div>
        </section>

        {/* PAID / PENDING / NETWORK — tight stat tiles */}
        <section
          data-testid="referrals-stat-tiles"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          <StatTile
            tone="emerald"
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Paid"
            value={paidCoins.toLocaleString()}
            sub={`${paidEvents} cashback ${paidEvents === 1 ? "event" : "events"}`}
            unit="OG"
          />
          <StatTile
            tone="amber"
            icon={<Hourglass className="h-4 w-4" />}
            label="Pending"
            value={pendingReferees.toLocaleString()}
            sub="Awaiting first burn"
            unit="refs"
          />
          <div className="col-span-2 sm:col-span-1">
            <StatTile
              tone="sky"
              icon={<Users className="h-4 w-4" />}
              label="Network"
              value={summary.total_referred.toLocaleString()}
              sub="Lifetime sign-ups"
              unit="nodes"
            />
          </div>
        </section>

        {/* SHARE LINK + QR — fused command bar */}
        <section className="rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-primary">
              Your OG Link
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[0.7rem] font-black uppercase tracking-[0.18em] text-emerald-300">
              Active
            </span>
          </div>

          <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    readOnly
                    value={shortLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-11 pl-9 font-mono text-xs sm:text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={copy} className="h-11 gap-2">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button variant="secondary" onClick={inviteAgain} className="h-11 gap-2">
                    <Gift className="h-4 w-4" /> Invite
                  </Button>
                  <Button variant="outline" onClick={share} className="h-11 gap-2">
                    <Share2 className="h-4 w-4" /> Share
                  </Button>
                </div>
              </div>

              {/* OG Leader Code */}
              {user && (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-primary">
                      Your OG Leader code
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!myCode}
                      onClick={async () => {
                        if (!myCode) return;
                        const ok = await copyTextWithFallback(myCode);
                        ok ? toast.success(`Code ${myCode} copied`) : toast.error("Couldn't copy");
                      }}
                      className="h-7 gap-1.5 px-2 text-xs"
                    >
                      <Copy className="h-3 w-3" /> Copy code
                    </Button>
                  </div>
                  <div className="mt-1 font-mono text-2xl font-black tracking-widest text-foreground">
                    {codeQ.isLoading ? "Loading…" : (myCode ?? "—")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Friends paste this in "Connect OG Leader" — locks you in for life. 10% of every
                    coin they burn → yours.
                  </div>
                </div>
              )}
            </div>

            {link && (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-background/60 p-3 md:w-44">
                <div className="rounded-xl bg-white p-2.5">
                  <QRCodeSVG
                    id="og-referral-qr"
                    value={link}
                    size={144}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[0.7rem] font-black uppercase tracking-[0.18em] text-muted-foreground">
                  <QrCode className="h-3 w-3" /> Scan to join
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
        </section>

        {/* EARNING MISSIONS — How it works as gamified tiles */}
        <section className="grid gap-3 sm:grid-cols-3">
          <Mission
            tone="primary"
            n={1}
            icon={<Link2 className="h-5 w-5" />}
            title="Drop your link"
            body="Group chats, bio, DMs — one link works everywhere."
          />
          <Mission
            tone="fuchsia"
            n={2}
            icon={<UserPlus className="h-5 w-5" />}
            title="Crew signs up"
            body="They open it, register, and start cooking on MusicHub."
          />
          <Mission
            tone="destructive"
            n={3}
            icon={<Flame className="h-5 w-5" />}
            title="You bank 10% forever"
            body="Their successful payments and coin use reward your wallet automatically."
          />
        </section>

        {/* BIND LEADER — kept anchor */}
        <section
          id="bind-referrer"
          className="scroll-mt-24 rounded-3xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl sm:p-6"
        >
          <div className="mb-3 flex items-center gap-2 text-[0.7rem] font-black uppercase tracking-[0.22em] text-rose-300">
            <KeyRound className="h-3.5 w-3.5" /> Connect your OG Leader
          </div>
          <BindReferrerCard />
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
                  Share your OG Link — the first burn from a referee lands here.
                </div>
                <Button size="sm" onClick={share} className="mt-2 gap-2">
                  <Share2 className="h-3.5 w-3.5" /> Share your link
                </Button>
              </div>
            )}
            {summary.recent.map((tx) => {
              const burned = Number(tx.reference?.match(/burn:(\d+)/)?.[1] ?? 0);
              const isPayment = tx.type === "referral_payment";
              const when = new Date(tx.created_at);
              return (
                <div key={tx.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-black uppercase text-primary">
                      {(tx.referee_name ?? "?").slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate text-sm font-bold">
                        {tx.referee_name ?? "Referred user"}
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[0.7rem] font-black uppercase tracking-[0.16em] text-emerald-300">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Paid
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {isPayment ? (
                          <>Successful payment reward = </>
                        ) : burned > 0 ? (
                          <>{burned} used × 10% = </>
                        ) : (
                          <>Cashback = </>
                        )}
                        <span className="font-bold text-primary">+{tx.amount} OG</span>
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
  title: string;
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
