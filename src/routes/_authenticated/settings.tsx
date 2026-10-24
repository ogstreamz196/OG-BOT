import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import {
  Loader2,
  Crown,
  Coins,
  UserRound,
  ArrowDownRight,
  ArrowUpRight,
  KeyRound,
  Receipt,
  Copy,
  LogOut,
  CalendarDays,
  Gift,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { OgVipIdCard } from "@/components/vip/OgVipIdCard";
import { OgVaultPassCard } from "@/components/vip/OgVaultPassCard";
import { VipRequestCard } from "@/components/vip/VipRequestCard";
import { VipStatusCard } from "@/components/settings/VipStatusCard";
import { Paywall } from "@/components/revenuecat/Paywall";
import { PreferencesPanel } from "@/components/settings/PreferencesPanel";
import { BossControls } from "@/components/settings/BossControls";
import { MemoryCard } from "@/components/settings/MemoryCard";
import { SettingRow, SettingsCard } from "@/components/settings/SettingsCard";
import { TelegramConnectCard } from "@/components/profile/TelegramConnectCard";
import { DeleteMyAccount } from "@/components/DeleteMyAccount";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings | OG B0T — AI Songs & Diss Tracks" },
      {
        name: "description",
        content: "Your OG B0T account: profile, VIP, Vault pass, coins and preferences.",
      },
      { property: "og:title", content: "Settings | OG B0T — AI Songs & Diss Tracks" },
      {
        property: "og:description",
        content: "Your OG B0T account: profile, VIP, Vault pass, coins and preferences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const USERNAME_DOMAIN = "@ogstreamz.app";
const BIO_MAX = 400;

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

function SettingsPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { hasVipRole, isAdmin } = useRole();
  const qc = useQueryClient();

  const [native, setNative] = useState(false);
  useEffect(() => setNative(Capacitor.isNativePlatform()), []);

  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [bio, setBio] = useState("");
  const [bioDirty, setBioDirty] = useState(false);
  const [email, setEmail] = useState("");
  const [showActivity, setShowActivity] = useState(false);
  const [limit, setLimit] = useState(10);

  const savedBio = (profile as { artist_bio?: string | null } | undefined)?.artist_bio ?? "";
  useEffect(() => {
    if (profile && !nameDirty) setName(profile.display_name ?? "");
  }, [profile?.display_name, nameDirty]);
  useEffect(() => {
    if (profile && !bioDirty) setBio(savedBio);
  }, [savedBio, bioDirty]);

  const usernameAccount = !!user?.email?.toLowerCase().endsWith(USERNAME_DOMAIN);
  const pendingEmail = (user as { new_email?: string } | null)?.new_email;
  const provider = (user?.app_metadata?.provider as string | undefined) ?? "email";
  const providerLabel =
    provider === "google"
      ? "Google"
      : provider === "apple"
        ? "Apple"
        : usernameAccount
          ? "Username"
          : "Email";
  const hasPassword = provider === "email";

  const extras = useQuery({
    queryKey: ["profile-extras", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("referral_code, created_at, og_vip_id")
        .eq("id", user!.id)
        .maybeSingle();
      return (data ?? {}) as {
        referral_code?: string | null;
        created_at?: string;
        og_vip_id?: string | null;
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
      setNameDirty(false);
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBio = useMutation({
    mutationFn: async () => {
      const v = bio.trim().slice(0, BIO_MAX);
      const { error } = await supabase
        .from("profiles")
        .update({ artist_bio: v || null } as never)
        .eq("id", user!.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Bio saved. New songs can mention it.");
      setBioDirty(false);
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
        { emailRedirectTo: `${window.location.origin}/settings` },
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
      ? `https://ogbot.co.uk/r/${extras.data.referral_code}`
      : null;
  const activity = txs.data ?? [];

  return (
    <DashboardShell title="Settings">
      <div className="mx-auto max-w-2xl space-y-6 pb-10">
        {/* Who you are, at a glance */}
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
              <h1 className="flex items-center gap-1.5 truncate font-display text-xl font-bold">
                <span className="truncate">{profile?.display_name || "OG Member"}</span>
                {hasVipRole && (
                  <Crown className="h-4 w-4 shrink-0 fill-current text-coin" aria-label="VIP" />
                )}
              </h1>
              {extras.data?.created_at && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="h-3 w-3" /> Member since{" "}
                  {new Date(extras.data.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>
          <div className="relative mt-4 flex items-center justify-between gap-3 rounded-2xl border border-coin/30 bg-background/50 px-4 py-2.5">
            <span className="inline-flex items-center gap-2 font-bold">
              <Coins className="h-5 w-5 text-coin" />
              <span className="text-lg tabular-nums">{profile?.coin_balance ?? 0}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                coins
              </span>
            </span>
            <Button asChild size="sm">
              <Link to="/store">Top up</Link>
            </Button>
          </div>
        </section>

        {/* Quick jump to each section */}
        <nav aria-label="Settings sections" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {SECTIONS.filter((x) => x.id !== "boss" || isAdmin).map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold text-foreground transition hover:brightness-125 ${x.chip}`}
            >
              {x.icon}
              {x.short}
            </a>
          ))}
        </nav>

        {/* 1. Profile & identity */}
        <Group section="profile">
          <SettingsCard
            icon={<UserRound className="h-5 w-5" />}
            title="Your profile"
            tone="violet"
            hint="How you show up on your tracks and in chat."
          >
            <form
              className="space-y-1.5"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                saveName.mutate();
              }}
            >
              <Label htmlFor="username">Display name</Label>
              <div className="flex gap-2">
                <Input
                  id="username"
                  value={name}
                  maxLength={30}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameDirty(true);
                  }}
                  placeholder="Your name"
                />
                <Button type="submit" disabled={!nameDirty || saveName.isPending}>
                  {saveName.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">2 to 30 characters.</p>
            </form>

            <form
              className="space-y-1.5"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                saveBio.mutate();
              }}
            >
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="artist-bio">
                  Artist bio <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <span className="text-[0.7rem] tabular-nums text-muted-foreground">
                  {bio.length}/{BIO_MAX}
                </span>
              </div>
              <Textarea
                id="artist-bio"
                value={bio}
                rows={2}
                maxLength={BIO_MAX}
                onChange={(e) => {
                  setBio(e.target.value.slice(0, BIO_MAX));
                  setBioDirty(true);
                }}
                placeholder="e.g. South London rapper, raised by my nan, never quits."
              />
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  A line or two about you. Your songs can mention it.
                </p>
                {bioDirty && (
                  <Button type="submit" size="sm" disabled={saveBio.isPending}>
                    {saveBio.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                  </Button>
                )}
              </div>
            </form>
          </SettingsCard>
          {extras.data?.og_vip_id && <OgVipIdCard id={extras.data.og_vip_id} />}
          <OgVaultPassCard />
        </Group>

        {/* 2. Membership & integrations */}
        <Group section="membership">
          {native ? (
            <Paywall />
          ) : (
            <VipStatusCard className="border-rose-400/40 border-l-4 border-l-rose-400 bg-gradient-to-br from-rose-500/[0.2] via-card to-card" />
          )}
          {hasVipRole && <VipRequestCard />}
          <TelegramConnectCard />
          {referralLink && (
            <SettingsCard
              icon={<Gift className="h-5 w-5" />}
              title="Invite friends"
              tone="emerald"
              hint="You earn coins when friends join and spend."
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
              <Link
                to="/referrals"
                className="inline-block text-xs font-semibold text-foreground underline-offset-4 hover:underline"
              >
                See my earnings
              </Link>
            </SettingsCard>
          )}
        </Group>

        {/* 3. Preferences & coins */}
        <Group section="preferences">
          <PreferencesPanel />
          <MemoryCard />
          <SettingsCard
            icon={<Coins className="h-5 w-5 text-coin" />}
            title="Coin activity"
            tone="gold"
            hint="Where your coins came from and went."
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-background/40 p-3">
                <p className="text-xs uppercase text-muted-foreground">Earned & bought</p>
                <p className="text-lg font-bold text-emerald-400">+{totals.earned}</p>
              </div>
              <div className="rounded-xl border border-border bg-background/40 p-3">
                <p className="text-xs uppercase text-muted-foreground">Spent</p>
                <p className="text-lg font-bold text-destructive">-{totals.spent}</p>
              </div>
            </div>
            {showActivity &&
              (txs.isLoading ? (
                <div className="grid place-items-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : activity.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">Nothing here yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activity.slice(0, limit).map((t) => (
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
                        <p className="text-xs text-muted-foreground">
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
              ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() =>
                  showActivity && activity.length > limit
                    ? setLimit((l) => l + 20)
                    : setShowActivity((v) => !v)
                }
              >
                {!showActivity
                  ? "See full history"
                  : activity.length > limit
                    ? "Show more"
                    : "Hide history"}
              </Button>
              <Button asChild variant="outline">
                <Link to="/purchase-history">
                  <Receipt className="mr-2 h-4 w-4" /> Card receipts
                </Link>
              </Button>
            </div>
          </SettingsCard>
        </Group>

        {/* 4. Security & danger zone */}
        <Group section="security">
          <SettingsCard
            icon={<Lock className="h-5 w-5" />}
            title="Sign-in & security"
            tone="slate"
            hint={`You sign in with ${providerLabel}.`}
          >
            <form
              className="space-y-1.5"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                saveEmail.mutate();
              }}
            >
              <Label htmlFor="new-email" className="inline-flex items-center gap-1.5">
                <Mail className="h-4 w-4" /> Recovery email
              </Label>
              <p className="text-xs">
                {displayEmail ? (
                  <span className="font-medium">{displayEmail}</span>
                ) : (
                  <span className="text-amber-300">
                    No email yet. Add one so you can reset your password if you forget it.
                  </span>
                )}
              </p>
              {pendingEmail && (
                <p className="text-xs text-muted-foreground">
                  Waiting for you to confirm <span className="font-medium">{pendingEmail}</span>.
                  Check your inbox.
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  id="new-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={displayEmail ? "New email" : "you@example.com"}
                />
                <Button type="submit" disabled={!email || saveEmail.isPending}>
                  {saveEmail.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {displayEmail ? "Change" : "Add"}
                </Button>
              </div>
            </form>
            {hasPassword && (
              <SettingRow label="Password" hint="You'll need your current password.">
                <Button asChild size="sm" variant="outline">
                  <Link to="/change-password">
                    <KeyRound className="mr-1.5 h-4 w-4" /> Change
                  </Link>
                </Button>
              </SettingRow>
            )}
            <Button variant="outline" className="w-full" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out of this device
            </Button>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <Link
                to="/policy"
                className="font-semibold text-foreground underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              <Link
                to="/terms"
                className="font-semibold text-foreground underline-offset-4 hover:underline"
              >
                Terms of Use
              </Link>
              <Link
                to="/delete-account"
                className="font-semibold text-foreground underline-offset-4 hover:underline"
              >
                How account deletion works
              </Link>
            </div>
          </SettingsCard>
          <DeleteMyAccount />
        </Group>

        {isAdmin && (
          <Group section="boss">
            <BossControls />
          </Group>
        )}
      </div>
    </DashboardShell>
  );
}

type SectionId = "profile" | "membership" | "preferences" | "security" | "boss";

/** The page's sections, in order: jump-bar label, heading, plain explanation. */
const SECTIONS: {
  id: SectionId;
  short: string;
  title: string;
  about: string;
  icon: ReactNode;
  chip: string;
}[] = [
  {
    id: "profile",
    short: "Profile",
    title: "Profile & identity",
    about: "How you show up, plus your VIP ID and Vault login.",
    icon: <UserRound className="h-3.5 w-3.5" />,
    chip: "border-violet-400/40 bg-violet-500/15",
  },
  {
    id: "membership",
    short: "Membership",
    title: "Membership & integrations",
    about: "Your VIP plan, Telegram and your invite link.",
    icon: <Crown className="h-3.5 w-3.5" />,
    chip: "border-rose-400/40 bg-rose-500/15",
  },
  {
    id: "preferences",
    short: "Preferences",
    title: "Preferences & coins",
    about: "How OG B0T talks, what it remembers, how the app looks, and your coins.",
    icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
    chip: "border-orange-400/40 bg-orange-500/15",
  },
  {
    id: "security",
    short: "Security",
    title: "Security",
    about: "Sign-in, recovery email, signing out and deleting your account.",
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    chip: "border-zinc-300/40 bg-zinc-400/15",
  },
  {
    id: "boss",
    short: "Boss",
    title: "Boss only",
    about: "Only you can see this.",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    chip: "border-violet-400/40 bg-violet-500/15",
  },
];

function Group({ section, children }: { section: SectionId; children: ReactNode }) {
  const s = SECTIONS.find((x) => x.id === section)!;
  return (
    <section id={section} className="scroll-mt-24 space-y-3">
      <header className="flex items-start gap-2.5 px-1">
        <span
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-foreground ${s.chip}`}
        >
          {s.icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-foreground">
            {s.title}
          </h2>
          <p className="text-xs text-muted-foreground">{s.about}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
