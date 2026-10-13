import { createFileRoute, Link } from "@tanstack/react-router";
import { OgVipIdCard } from "@/components/vip/OgVipIdCard";
import { VipRequestCard } from "@/components/vip/VipRequestCard";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Crown,
  Coins,
  Mail,
  UserRound,
  ArrowDownRight,
  ArrowUpRight,
  KeyRound,
  Receipt,
  Send,
  Copy,
  Music2,
  LogOut,
  ShieldCheck,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TelegramConnectCard } from "@/components/profile/TelegramConnectCard";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — OG BOT" },
      { name: "description", content: "Manage your OG BOT username, email, coins and activity." },
      { property: "og:title", content: "My Profile — OG BOT" },
      {
        property: "og:description",
        content: "Manage your OG BOT username, email, coins and activity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

const USERNAME_DOMAIN = "@ogstreamz.app";

type Tx = {
  id: string;
  amount: number;
  type: string;
  reference: string | null;
  created_at: string;
};

function txLabel(type: string, ref: string | null): string {
  const t = `${type} ${ref ?? ""}`.toLowerCase();
  if (t.includes("remake") || t.includes("variation") || t.includes("reveal"))
    return "Remade track";
  if (t.includes("unlock")) return "Unlocked a track";
  if (t.includes("generat") || t.includes("song")) return "Created a track";
  if (t.includes("refund")) return "Refund";
  if (t.includes("daily")) return "Daily Drop";
  if (t.includes("battle")) return "Battle Zone reward";
  if (t.includes("welcome")) return "Welcome bonus";
  if (
    t.includes("referral") ||
    t.includes("royalty") ||
    t.includes("cashback") ||
    t.includes("commission")
  )
    return "Earnings";
  if (
    t.includes("stripe") ||
    t.includes("purchase") ||
    t.includes("revenuecat") ||
    t.includes("pack")
  )
    return "Bought coins";
  if (t.includes("vip")) return "VIP";
  if (t.includes("sports")) return "OG Sports Guide";
  if (t.includes("vault")) return "OG Vault pass";
  if (t.includes("download") || t.includes("community")) return "Community track download";
  if (t.includes("mint") || t.includes("admin") || t.includes("boss"))
    return "Adjustment by OG team";
  return type.replace(/_/g, " ");
}

function ProfilePage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { hasVipRole, roles } = useRole();
  const hasBossRole = (roles as string[] | undefined)?.includes("boss") ?? false;
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [email, setEmail] = useState("");
  const [filter, setFilter] = useState<"all" | "spent" | "earned">("all");
  const [limit, setLimit] = useState(20);

  useEffect(() => {
    if (profile && !dirty) setName(profile.display_name ?? "");
  }, [profile?.display_name, dirty]);

  const usernameAccount = !!user?.email?.toLowerCase().endsWith(USERNAME_DOMAIN);
  const pendingEmail = (user as { new_email?: string } | null)?.new_email;

  const extras = useQuery({
    queryKey: ["profile-extras", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [p, songs] = await Promise.all([
        supabase
          .from("profiles")
          .select("referral_code, telegram_username, telegram_linked_at, created_at, og_vip_id")
          .eq("id", user!.id)
          .maybeSingle(),
        supabase
          .from("songs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("status", "completed"),
      ]);
      return { ...(p.data ?? {}), trackCount: songs.count ?? 0 } as {
        referral_code?: string | null;
        telegram_username?: string | null;
        telegram_linked_at?: string | null;
        created_at?: string;
        og_vip_id?: string | null;
        trackCount: number;
      };
    },
  });

  const txs = useQuery({
    queryKey: ["my-coin-tx", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coin_transactions")
        .select("id, amount, type, reference, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as Tx[];
    },
  });

  const totals = useMemo(() => {
    let spent = 0;
    let earned = 0;
    for (const t of txs.data ?? []) {
      if (t.amount < 0) spent += -t.amount;
      else earned += t.amount;
    }
    return { spent, earned };
  }, [txs.data]);

  const filtered = (txs.data ?? []).filter((t) =>
    filter === "all" ? true : filter === "spent" ? t.amount < 0 : t.amount > 0,
  );

  const saveName = useMutation({
    mutationFn: async () => {
      const v = name.trim();
      if (v.length < 2) throw new Error("Username must be at least 2 characters");
      if (v.length > 30) throw new Error("Username must be 30 characters or less");
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: v })
        .eq("id", user!.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Username updated");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveEmail = useMutation({
    mutationFn: async () => {
      const v = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error("Enter a valid email address");
      const { error } = await supabase.auth.updateUser(
        { email: v },
        { emailRedirectTo: `${window.location.origin}/profile` },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Check your inbox to confirm the new email.");
      setEmail("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.replace("/welcome");
  };

  const displayEmail = usernameAccount ? null : user?.email;
  const initial = (profile?.display_name || user?.email || "U")[0]?.toUpperCase();
  const referralLink =
    extras.data?.referral_code && typeof window !== "undefined"
      ? `${window.location.origin}/r/${extras.data.referral_code}`
      : null;

  return (
    <DashboardShell title="Profile">
      <div className="mx-auto max-w-2xl space-y-5 pb-10">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-card">
          <div className="pointer-events-none absolute inset-0 bg-gradient-brand opacity-10" />
          <div className="relative flex items-center gap-4">
            <div
              className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-2xl font-black text-primary-foreground ${
                hasVipRole ? "ring-2 ring-amber-400" : ""
              }`}
            >
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl font-bold">
                {profile?.display_name || "OG Member"}
              </h1>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {hasVipRole && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-300">
                    <Crown className="h-3 w-3" /> OG VIP
                  </span>
                )}
                {hasBossRole && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase text-primary">
                    <ShieldCheck className="h-3 w-3" /> Boss
                  </span>
                )}
                {extras.data?.created_at && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" /> Since{" "}
                    {new Date(extras.data.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="relative mt-4 grid grid-cols-3 gap-2">
            <Stat
              icon={<Coins className="h-4 w-4 text-coin" />}
              label="Balance"
              value={profile?.coin_balance ?? 0}
            />
            <Stat
              icon={<Music2 className="h-4 w-4 text-primary" />}
              label="Tracks"
              value={extras.data?.trackCount ?? 0}
            />
            <Stat
              icon={<ArrowDownRight className="h-4 w-4 text-destructive" />}
              label="Spent"
              value={totals.spent}
            />
          </div>
          <div className="relative mt-3 flex gap-2">
            <Button asChild className="flex-1">
              <Link to="/store">Top up coins</Link>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link to="/library">My tracks</Link>
            </Button>
          </div>
        </section>

        {extras.data?.og_vip_id && <OgVipIdCard id={extras.data.og_vip_id} />}
        <VipRequestCard />

        <TelegramConnectCard />

        <Tabs defaultValue="account" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="coins">Coins</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-5">
            {/* Username */}
            <Card
              icon={<UserRound className="h-5 w-5" />}
              title="Username"
              hint="Shown on your tracks and in chat."
            >
              <form
                className="flex gap-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  saveName.mutate();
                }}
              >
                <Input
                  aria-label="Username"
                  value={name}
                  maxLength={30}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Your username"
                />
                <Button type="submit" disabled={!dirty || saveName.isPending}>
                  {saveName.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                </Button>
              </form>
            </Card>

            {/* Email */}
            <Card
              icon={<Mail className="h-5 w-5" />}
              title="Linked email"
              hint="Used only to reset your password if you forget it."
            >
              <p className="text-sm">
                {displayEmail ? (
                  <span className="font-medium">{displayEmail}</span>
                ) : (
                  <span className="text-amber-300">
                    No recovery email yet — add one so you never lose your account.
                  </span>
                )}
              </p>
              {pendingEmail && (
                <p className="text-xs text-muted-foreground">
                  Waiting for you to confirm <span className="font-medium">{pendingEmail}</span> —
                  check your inbox.
                </p>
              )}
              <form
                className="space-y-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  saveEmail.mutate();
                }}
              >
                <Label htmlFor="new-email" className="text-xs text-muted-foreground">
                  {displayEmail ? "Change email" : "Add email"}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="new-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                  <Button type="submit" disabled={!email || saveEmail.isPending}>
                    {saveEmail.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send
                    link
                  </Button>
                </div>
              </form>
            </Card>

            {referralLink && (
              <Card
                icon={<Copy className="h-5 w-5" />}
                title="Invite friends"
                hint="Earn coins when friends join."
              >
                <div className="flex gap-2">
                  <Input readOnly value={referralLink} aria-label="Invite link" />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy invite link"
                    onClick={() => {
                      navigator.clipboard.writeText(referralLink);
                      toast.success("Invite link copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="coins" className="space-y-5">
            {/* Coin activity */}
            <Card
              icon={<Coins className="h-5 w-5 text-coin" />}
              title="Coin activity"
              hint="Where your coins came from and went."
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border bg-background/40 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Earned & bought</p>
                  <p className="text-lg font-bold text-emerald-400">+{totals.earned}</p>
                </div>
                <div className="rounded-xl border border-border bg-background/40 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Spent</p>
                  <p className="text-lg font-bold text-destructive">-{totals.spent}</p>
                </div>
              </div>
              <div className="flex gap-1.5" role="tablist">
                {(["all", "spent", "earned"] as const).map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                      filter === f
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {txs.isLoading ? (
                <div className="grid place-items-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing here yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.slice(0, limit).map((t) => (
                    <li key={t.id} className="flex items-center gap-3 py-2.5">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                          t.amount < 0
                            ? "bg-destructive/15 text-destructive"
                            : "bg-emerald-500/15 text-emerald-400"
                        }`}
                      >
                        {t.amount < 0 ? (
                          <ArrowDownRight className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {txLabel(t.type, t.reference)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(t.created_at).toLocaleString(undefined, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-bold ${t.amount < 0 ? "text-destructive" : "text-emerald-400"}`}
                      >
                        {t.amount > 0 ? "+" : ""}
                        {t.amount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {filtered.length > limit && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setLimit((l) => l + 20)}
                >
                  Show more
                </Button>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-5">
            {/* Security */}
            <Card icon={<KeyRound className="h-5 w-5" />} title="Account & security">
              <div className="grid gap-2 sm:grid-cols-2">
                <Button asChild variant="outline">
                  <Link to="/change-password">
                    <KeyRound className="mr-2 h-4 w-4" /> Change password
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/purchase-history">
                    <Receipt className="mr-2 h-4 w-4" /> Purchase history
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/settings">More settings</Link>
                </Button>
                <Button variant="outline" onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-2.5 text-center">
      <div className="flex justify-center">{icon}</div>
      <p className="mt-1 text-lg font-bold leading-none">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Card({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
