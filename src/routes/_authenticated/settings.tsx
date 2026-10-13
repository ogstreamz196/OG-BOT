import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Crown,
  Bot,
  ShieldCheck,
  Coins,
  Plus,
  Minus,
  LogOut,
  UserCog,
  Mail,
  Fingerprint,
  KeyRound,
  Send,
  Copy,
  ExternalLink,
  Bell,
  HardDrive,
  RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useDevMode } from "@/hooks/use-dev-mode";
import { useProfile } from "@/hooks/use-profile";
import { useRole } from "@/hooks/use-role";
import { DeleteMyAccount } from "@/components/DeleteMyAccount";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { PreferencesPanel } from "@/components/settings/PreferencesPanel";
import { VipStatusCard } from "@/components/settings/VipStatusCard";
import { Paywall } from "@/components/revenuecat/Paywall";

import {
  getMyTelegramLinkToken,
  rotateMyTelegramLinkToken,
  getMyTelegramStatus,
} from "@/lib/telegram-admin.functions";
import { TelegramLinkStatus } from "@/components/dashboard/TelegramLinkStatus";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const dev = useDevMode();
  const { data: profile, refetch } = useProfile();
  const { isAdmin, isVip, roles } = useRole();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [bio, setBio] = useState("");
  const [bioDirty, setBioDirty] = useState(false);
  const [balance, setBalance] = useState("");
  const [balanceDirty, setBalanceDirty] = useState(false);
  const [adjust, setAdjust] = useState("");

  useEffect(() => {
    if (profile && !nameDirty) setName(profile.display_name ?? (dev.isDev ? "Developer" : ""));
  }, [profile?.display_name, nameDirty, dev.isDev]);
  useEffect(() => {
    if (profile && !bioDirty) setBio((profile as { artist_bio?: string | null }).artist_bio ?? "");
  }, [(profile as { artist_bio?: string | null } | undefined)?.artist_bio, bioDirty]);
  useEffect(() => {
    if (profile && !balanceDirty) setBalance(String(profile.coin_balance ?? 0));
  }, [profile?.coin_balance, balanceDirty]);

  const isOgBot = (roles as string[]).includes("og_bot");

  const saveName = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Display name required");
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", user!.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Display name updated");
      setNameDirty(false);
      refetch();
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBio = useMutation({
    mutationFn: async () => {
      const trimmed = bio.trim().slice(0, 400);
      const { error } = await supabase
        .from("profiles")
        .update({ artist_bio: trimmed || null } as never)
        .eq("id", user!.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Artist bio saved — MusicHub will weave it into new lyrics");
      setBioDirty(false);
      refetch();
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBalance = useMutation({
    mutationFn: async () => {
      const n = Number.parseInt(balance, 10);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid balance");
      const { data, error } = await supabase.rpc("set_balance_admin", {
        target_user_id: user!.id,
        new_balance: n,
        admin_notes: "self_settings_set",
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: () => {
      toast.success("Balance set");
      setBalanceDirty(false);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustCoins = useMutation({
    mutationFn: async (delta: number) => {
      if (!Number.isFinite(delta) || delta === 0) throw new Error("Enter a non-zero amount");
      const { data, error } = await supabase.rpc("mint_coins_admin", {
        target_user_id: user!.id,
        amount: delta,
        admin_notes: "self_settings_adjust",
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (newBal, delta) => {
      toast.success(`${delta > 0 ? "+" : ""}${delta} coins · ${newBal}`);
      setAdjust("");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRole = useMutation({
    mutationFn: async ({
      rpc,
      key,
      value,
    }: {
      rpc: "set_vip_admin" | "set_og_bot_admin";
      key: "make_vip" | "make_og";
      value: boolean;
    }) => {
      const args: Record<string, unknown> = {
        target_user_id: user!.id,
        admin_notes: "self_settings_toggle",
      };
      args[key] = value;
      const { error } = await supabase.rpc(rpc as never, args as never);
      if (error) throw new Error(error.message);
      return value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-role", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.replace("/welcome");
  };

  return (
    <DashboardShell title="Settings">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Identity */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
          <header className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-brand">
              <UserCog className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold">Profile</h2>
              <p className="truncate text-xs text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3 w-3" /> {dev.isDev ? "developer@local" : user?.email}
              </p>
            </div>
          </header>

          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <div className="flex gap-2">
              <Input
                id="display-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameDirty(true);
                }}
                maxLength={80}
                placeholder="Your name"
              />
              <Button onClick={() => saveName.mutate()} disabled={!nameDirty || saveName.isPending}>
                {saveName.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <Label htmlFor="artist-bio" className="flex min-w-0 flex-col gap-1">
                <span>Artist bio · woven into your lyrics</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Your name and bio appear a couple of times per song. Leave blank to opt out.
                </span>
              </Label>
              <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
                {bio.length}/400
              </span>
            </div>
            <Textarea
              id="artist-bio"
              value={bio}
              onChange={(e) => {
                setBio(e.target.value.slice(0, 400));
                setBioDirty(true);
              }}
              maxLength={400}
              rows={3}
              placeholder="e.g. South London rapper, ex-footballer, raised by my nan, never quits."
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => saveBio.mutate()}
                disabled={!bioDirty || saveBio.isPending}
              >
                {saveBio.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save bio
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5" />
              <span className="font-mono truncate max-w-[18ch]">{user?.id}</span>
            </span>
            {(() => {
              const provider = user?.app_metadata?.provider as string | undefined;
              if (!provider) return null;
              return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2 py-0.5 capitalize">
                  <KeyRound className="h-3 w-3" /> Signed in with {provider}
                </span>
              );
            })()}
          </div>
        </section>

        {/* Preferences — assistant, music, appearance */}
        <VipStatusCard />
        <Paywall />
        <PreferencesPanel />

        {/* Coins */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-coin" />
              <h2 className="font-semibold">Coins</h2>
            </div>
            <span className="text-lg font-semibold">{profile?.coin_balance ?? 0}</span>
          </header>

          {isAdmin ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="set-bal">Set balance</Label>
                <div className="flex gap-2">
                  <Input
                    id="set-bal"
                    type="number"
                    min={0}
                    value={balance}
                    onChange={(e) => {
                      setBalance(e.target.value);
                      setBalanceDirty(true);
                    }}
                  />
                  <Button
                    onClick={() => saveBalance.mutate()}
                    disabled={!balanceDirty || saveBalance.isPending}
                  >
                    {saveBalance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Set
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="adj-bal">Adjust by</Label>
                <div className="flex gap-2">
                  <Input
                    id="adj-bal"
                    type="number"
                    min={1}
                    value={adjust}
                    onChange={(e) => setAdjust(e.target.value)}
                    placeholder="0"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Add coins"
                    onClick={() => adjustCoins.mutate(Number.parseInt(adjust, 10))}
                    disabled={!adjust || adjustCoins.isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Subtract coins"
                    onClick={() => adjustCoins.mutate(-Number.parseInt(adjust, 10))}
                    disabled={!adjust || adjustCoins.isPending}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Need more coins?{" "}
              <Link to="/buy-coins" search={{}} className="text-primary underline">
                Top up
              </Link>
              .
            </p>
          )}
        </section>

        {/* Roles (admin only) */}
        {isAdmin && (
          <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-5">
            <header className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <h2 className="font-semibold leading-tight">Roles & access</h2>
                <p className="text-xs text-muted-foreground">
                  Toggle perks for yourself and mint tokens for others.
                </p>
              </div>
            </header>

            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Your roles
              </p>
              <RoleRow
                icon={<Crown className="h-5 w-5 text-amber-500" />}
                title="VIP"
                description="Premium tiers and bonus features."
                checked={isVip}
                pending={toggleRole.isPending}
                onChange={(v) =>
                  toggleRole.mutate({ rpc: "set_vip_admin", key: "make_vip", value: v })
                }
              />
              <RoleRow
                icon={<Bot className="h-5 w-5 text-primary" />}
                title="OG Bot"
                description="Automated/bot privileges."
                checked={isOgBot}
                pending={toggleRole.isPending}
                onChange={(v) =>
                  toggleRole.mutate({ rpc: "set_og_bot_admin", key: "make_og", value: v })
                }
              />
              <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-3 opacity-80">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <div>
                    <Label className="text-sm font-medium">Boss / admin</Label>
                    <p className="text-xs text-muted-foreground">Provisioned in the database.</p>
                  </div>
                </div>
                <Switch checked disabled />
              </div>
            </div>

            <Separator />
            <div className="flex flex-wrap gap-2">
              <Link to="/admin">
                <Button variant="outline" size="sm">
                  Admin home
                </Button>
              </Link>
              <Link to="/admin/users">
                <Button variant="outline" size="sm">
                  Manage users
                </Button>
              </Link>
            </div>
          </section>
        )}

        {/* Connect Telegram */}
        <TelegramConnectSection userId={user?.id ?? ""} />

        {/* Privacy & permissions */}
        <PrivacySection userId={user?.id ?? ""} />

        {/* Security */}
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="font-semibold">Password</h2>
            <p className="text-xs text-muted-foreground">
              Change your password — current password required.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full min-[430px]:w-auto">
            <Link to="/change-password">
              <KeyRound className="mr-2 h-4 w-4" /> Change password
            </Link>
          </Button>
        </section>

        {/* Session */}

        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="font-semibold">Session</h2>
            <p className="text-xs text-muted-foreground">Sign out of this device.</p>
          </div>
          <Button variant="outline" onClick={signOut} className="w-full min-[430px]:w-auto">
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </section>

        <DeleteMyAccount />
      </div>
    </DashboardShell>
  );
}

function RoleRow({
  icon,
  title,
  description,
  checked,
  pending,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  pending: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <Label className="text-sm font-medium">{title}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Switch checked={checked} disabled={pending} onCheckedChange={onChange} />
      </div>
    </div>
  );
}

const TELEGRAM_BOT_USERNAME = "OGStreamzBot";

function TelegramConnectSection({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const getTokenFn = useServerFn(getMyTelegramLinkToken);
  const rotateTokenFn = useServerFn(rotateMyTelegramLinkToken);
  const statusFn = useServerFn(getMyTelegramStatus);

  const statusQuery = useQuery({
    queryKey: ["my-telegram-status"],
    queryFn: () => statusFn(),
    enabled: !!userId,
    staleTime: 30_000,
  });
  const isLinked = statusQuery.data?.state === "verified";

  const tokenQuery = useQuery({
    queryKey: ["my-telegram-link-token"],
    queryFn: () => getTokenFn(),
    enabled: !!userId && !isLinked,
    staleTime: 60_000,
  });
  const token = tokenQuery.data?.token ?? "";
  const link = token ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}` : "";

  const rotate = useMutation({
    mutationFn: () => rotateTokenFn(),
    onSuccess: (res) => {
      qc.setQueryData(["my-telegram-link-token"], res);
      toast.success("Fresh Telegram link ready");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied — paste it into Telegram");
    } catch {
      toast.error("Couldn't copy. Long-press to copy instead.");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Send className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Telegram · OG Bot</h2>
          <p className="text-xs text-muted-foreground">
            {isLinked
              ? "Your Telegram is linked. Use Reconnect only if OG Bot stops responding."
              : "Connect once to chat with OG Bot about anything — lyrics, life, 3am thoughts."}
          </p>
        </div>
      </div>

      <TelegramLinkStatus />

      {!isLinked ? (
        <>
          <div className="rounded-xl border border-dashed border-border bg-background/40 p-3">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your personal connect link
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copy}
                title="Copy link"
                aria-label="Copy connect link"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Always use this button/link — typing plain /start in Telegram cannot connect your
              profile.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              disabled={!link || tokenQuery.isLoading}
              onClick={() => {
                if (!link) return;
                const w = window.open(link, "_blank", "noopener,noreferrer");
                if (!w) window.location.href = link;
              }}
              className="bg-[#229ED9] font-semibold text-white hover:bg-[#229ED9]/90"
            >
              {tokenQuery.isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}{" "}
              Connect Telegram
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => rotate.mutate()}
              disabled={rotate.isPending}
            >
              {rotate.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              Fresh link
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const url = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
                const w = window.open(url, "_blank", "noopener,noreferrer");
                if (!w) window.location.href = url;
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" /> Find @{TELEGRAM_BOT_USERNAME}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function PrivacySection({ userId }: { userId: string }) {
  // Browser-level permission state (read-only mirror of the OS prompts).
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (navigator.storage?.persisted) {
          const v = await navigator.storage.persisted();
          if (!cancelled) setStoragePersisted(v);
        }
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestNotifications() {
    if (typeof Notification === "undefined") return;
    try {
      const res = await Notification.requestPermission();
      setNotifPerm(res);
      toast.success(res === "granted" ? "Notifications on" : "Notifications kept off");
    } catch {
      /* noop */
    }
  }

  async function requestPersistentStorage() {
    try {
      const v = (await navigator.storage?.persist?.()) ?? false;
      setStoragePersisted(v);
      toast.success(v ? "Offline storage enabled" : "Browser denied persistent storage");
    } catch {
      toast.error("Couldn't request persistent storage");
    }
  }

  function resetPrompt() {
    try {
      localStorage.removeItem(`og:perms:asked:${userId}`);
      toast.success("Permission prompt will show again on your next visit");
    } catch {
      /* noop */
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold leading-tight">Privacy & permissions</h2>
            <p className="text-xs text-muted-foreground">
              Review what's on. Change anything anytime — nothing is shared without your say-so.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetPrompt}
          className="shrink-0 text-xs"
          title="Show the initial permissions dialog again on next visit"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Re-show prompt
        </Button>
      </header>

      {/* Notifications */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-3">
        <div className="flex items-center gap-3 min-w-0">
          <Bell className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <Label className="text-sm font-medium">Notifications</Label>
            <p className="text-xs text-muted-foreground">
              Song-ready pings & coin alerts.{" "}
              <span className="font-medium">
                {notifPerm === "granted"
                  ? "On."
                  : notifPerm === "denied"
                    ? "Blocked in your browser."
                    : notifPerm === "unsupported"
                      ? "Not supported here."
                      : "Off."}
              </span>
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={requestNotifications}
          disabled={
            notifPerm === "granted" || notifPerm === "denied" || notifPerm === "unsupported"
          }
        >
          {notifPerm === "granted" ? "Enabled" : "Enable"}
        </Button>
      </div>

      {/* Offline storage */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-3">
        <div className="flex items-center gap-3 min-w-0">
          <HardDrive className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <Label className="text-sm font-medium">Offline storage</Label>
            <p className="text-xs text-muted-foreground">
              Keeps your library cached.{" "}
              <span className="font-medium">
                {storagePersisted === true
                  ? "Persistent."
                  : storagePersisted === false
                    ? "Best-effort (may be evicted)."
                    : "Unknown."}
              </span>
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={requestPersistentStorage}
          disabled={storagePersisted === true}
        >
          {storagePersisted === true ? "Enabled" : "Enable"}
        </Button>
      </div>

      {/* Legal — required in-app links for the app stores */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 text-xs">
        <Link
          to="/policy"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Privacy Policy
        </Link>
        <Link to="/terms" className="font-semibold text-primary underline-offset-4 hover:underline">
          Terms of Use
        </Link>
        <Link
          to="/delete-account"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          How account deletion works
        </Link>
      </div>
    </section>
  );
}
