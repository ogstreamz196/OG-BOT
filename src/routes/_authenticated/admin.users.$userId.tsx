import { createFileRoute, Navigate, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  ShieldCheck,
  ArrowLeft,
  Crown,
  Coins,
  Plus,
  Minus,
  UserCog,
  Mail,
  Calendar,
  Fingerprint,
  Bot,
  Send,
  Copy,
  MessageCircle,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Trash2,
  KeyRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { maskDevIdentity } from "@/lib/dev-identity";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteUserAccount } from "@/lib/admin-delete-account.functions";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { UserAuditTrail } from "@/components/admin/UserAuditTrail";
import { TelegramSignInLog } from "@/components/admin/TelegramSignInLog";
import { DevBossPanel } from "@/components/admin/DevBossPanel";
import { VipExpiryDialog, useVipExpiry, formatVipExpiry } from "@/components/admin/VipExpiryDialog";
import {
  sendTelegramDm,
  retryTelegramDm,
  listTelegramDmsForUser,
  rotateTelegramLinkToken,
  sendTelegramTestPing,
  type TelegramQueueRow,
} from "@/lib/telegram-admin.functions";
import { Wrench, Flame } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/users/$userId")({
  component: UserSettingsPage,
});

const TELEGRAM_BOT_USERNAME = "OGStreamzBot";

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  coin_balance: number;
  created_at: string;
  telegram_chat_id: number | null;
  telegram_username: string | null;
}

function UserSettingsPage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const { isAdmin, isBoss, isLoading } = useRole();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState("");
  const deleteAccount = useMutation({
    mutationFn: () => deleteUserAccount({ data: { userId } }),
    onSuccess: () => {
      toast.success("Account deleted");
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
      navigate({ to: "/admin/users", replace: true });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const profileQ = useQuery({
    queryKey: ["admin-user-profile", userId],
    enabled: isAdmin,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, email, display_name, coin_balance, created_at, telegram_chat_id, telegram_username",
        )
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return maskDevIdentity((data ?? null) as ProfileRow | null);
    },
  });

  const rolesQ = useQuery({
    queryKey: ["admin-user-roles", userId],
    enabled: isAdmin,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as string);
    },
  });

  const vaultQ = useQuery({
    queryKey: ["admin-user-vault", userId],
    enabled: isAdmin,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("admin_has_vault_pass", { p_user: userId });
      if (error) throw error;
      return !!data;
    },
  });

  const [label, setLabel] = useState<string>("");
  const [labelDirty, setLabelDirty] = useState(false);
  const [balance, setBalance] = useState<string>("");
  const [balanceDirty, setBalanceDirty] = useState(false);
  const [adjust, setAdjust] = useState<string>("");

  // Hydrate inputs when profile loads
  if (profileQ.data && !labelDirty && label === "") {
    if (profileQ.data.display_name) setLabel(profileQ.data.display_name);
  }
  if (profileQ.data && !balanceDirty && balance === "") {
    setBalance(String(profileQ.data.coin_balance ?? 0));
  }

  const saveLabel = useMutation({
    mutationFn: async () => {
      const trimmed = label.trim();
      if (!trimmed) throw new Error("Display name required");
      const { data, error } = await supabase.rpc("admin_update_profile_label", {
        target_user_id: userId,
        new_display_name: trimmed,
        admin_notes: "settings_page",
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      toast.success("Display name updated");
      setLabelDirty(false);
      qc.invalidateQueries({ queryKey: ["admin-user-profile", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBalance = useMutation({
    mutationFn: async () => {
      const n = Number.parseInt(balance, 10);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid balance");
      const { data, error } = await supabase.rpc("set_balance_admin", {
        target_user_id: userId,
        new_balance: n,
        admin_notes: "settings_page_set",
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: () => {
      toast.success("Balance set");
      setBalanceDirty(false);
      qc.invalidateQueries({ queryKey: ["admin-user-profile", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustCoins = useMutation({
    mutationFn: async (delta: number) => {
      if (!Number.isFinite(delta) || delta === 0) throw new Error("Enter a non-zero amount");
      if (Math.abs(delta) > 100000) throw new Error("Max ±100,000 per adjustment");
      const { data, error } = await supabase.rpc("mint_coins_admin", {
        target_user_id: userId,
        amount: delta,
        admin_notes: "settings_page_adjust",
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (newBalance, delta) => {
      toast.success(`${delta > 0 ? "+" : ""}${delta} coins · new balance ${newBalance}`);
      setAdjust("");
      qc.invalidateQueries({ queryKey: ["admin-user-profile", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || profileQ.isLoading) {
    return (
      <DashboardShell title="User settings">
        <div className="grid h-64 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  const profile = profileQ.data;
  if (!profile) {
    return (
      <DashboardShell title="User settings">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">User not found.</p>
          <Link to="/admin/users">
            <Button variant="outline" className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to users
            </Button>
          </Link>
        </div>
      </DashboardShell>
    );
  }

  const roles = rolesQ.data ?? [];
  const isVip = roles.includes("vip");
  const isAdminUser = roles.includes("admin");

  const adjustParsed = Number.parseInt(adjust, 10);
  const adjustValid = Number.isFinite(adjustParsed) && adjustParsed > 0;

  return (
    <DashboardShell title="User settings">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-brand">
            <UserCog className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="truncate font-semibold">
              {profile.display_name ?? profile.email ?? "Unnamed user"}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
          </div>
          <Link to="/admin/users">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> All users
            </Button>
          </Link>
        </div>

        {/* Overview */}
        <section className="grid gap-4 sm:grid-cols-3">
          <InfoCard
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            value={profile.email ?? "—"}
          />
          <InfoCard
            icon={<Coins className="h-4 w-4 text-coin" />}
            label="Balance"
            value={String(profile.coin_balance ?? 0)}
          />
          <InfoCard
            icon={<Calendar className="h-4 w-4" />}
            label="Joined"
            value={new Date(profile.created_at).toLocaleDateString()}
          />
        </section>

        {isBoss && !roles.some((role) => ["admin", "boss", "dev"].includes(role)) && (
          <section className="border-t border-destructive/40 pt-6">
            <h3 className="font-semibold text-destructive">Delete account</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Permanently removes this account and its linked records. This cannot be undone.
            </p>
            <AlertDialog
              onOpenChange={(open) => {
                if (!open) setConfirmDelete("");
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="mt-4 gap-2">
                  <Trash2 className="h-4 w-4" /> Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {profile.display_name ?? profile.email ?? "this account"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    All linked account data will be permanently removed. Type DELETE to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Label htmlFor="confirm-delete-account">Confirmation</Label>
                <Input
                  id="confirm-delete-account"
                  value={confirmDelete}
                  onChange={(event) => setConfirmDelete(event.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    disabled={confirmDelete !== "DELETE" || deleteAccount.isPending}
                    onClick={() => deleteAccount.mutate()}
                  >
                    {deleteAccount.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Permanently delete
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        )}

        {/* Identity */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
          <header>
            <h3 className="font-semibold">Identity</h3>
            <p className="text-sm text-muted-foreground">Display label shown across the app.</p>
          </header>
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <div className="flex gap-2">
              <Input
                id="display-name"
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setLabelDirty(true);
                }}
                maxLength={80}
                placeholder="No label"
              />
              <Button
                onClick={() => saveLabel.mutate()}
                disabled={!labelDirty || saveLabel.isPending}
              >
                {saveLabel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Fingerprint className="h-3.5 w-3.5" />
            <span className="font-mono">{profile.id}</span>
          </div>
        </section>

        {/* Roles & access */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
          <header>
            <h3 className="font-semibold">Roles & access</h3>
            <p className="text-sm text-muted-foreground">
              Grant VIP perks, OG Bot access, and review role assignments.
            </p>
          </header>

          <RoleToggleRow
            icon={<Crown className="h-5 w-5 text-amber-500" />}
            title="VIP member"
            description="Unlocks premium tiers and bonus features."
            checked={isVip}
            userId={profile.id}
            role="vip"
            rpc="set_vip_admin"
            paramKey="make_vip"
            vipExpiry
          />

          <VaultToggleRow
            userId={profile.id}
            checked={vaultQ.data ?? false}
            loading={vaultQ.isLoading}
          />

          <RoleToggleRow
            icon={<Bot className="h-5 w-5 text-primary" />}
            title="OG Bot access"
            description="Grants automated/bot privileges across the site."
            checked={roles.includes("og_bot")}
            userId={profile.id}
            role="og_bot"
            rpc="set_og_bot_admin"
            paramKey="make_og"
          />

          <RoleToggleRow
            icon={<Wrench className="h-5 w-5 text-sky-500" />}
            title="Dev"
            description="Can manually override any user's coin balance."
            checked={roles.includes("dev")}
            userId={profile.id}
            role="dev"
            rpc="set_dev_admin"
            paramKey="make_dev"
          />

          <RoleToggleRow
            icon={<Flame className="h-5 w-5 text-orange-500" />}
            title="Boss"
            description="Can burn or reclaim OG coins from any user."
            checked={roles.includes("boss")}
            userId={profile.id}
            role="boss"
            rpc="set_boss_admin"
            paramKey="make_boss"
          />

          <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-4 opacity-80">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <Label className="text-sm font-medium">Boss / admin</Label>
                <p className="text-xs text-muted-foreground">
                  Provisioned in the database for security.
                </p>
              </div>
            </div>
            <Switch checked={isAdminUser} disabled />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {roles.length === 0 ? (
              <span className="text-xs text-muted-foreground">No extra roles</span>
            ) : (
              roles.map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                >
                  {r}
                </span>
              ))
            )}
          </div>
        </section>

        {/* Coins */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
          <header>
            <h3 className="font-semibold">Coin balance</h3>
            <p className="text-sm text-muted-foreground">
              Balance now: <b className="font-mono">{(profile.coin_balance ?? 0).toLocaleString()}</b>.
              Every change is logged.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="set-balance">Replace total balance with</Label>
              <p className="text-[11px] text-muted-foreground">Overwrites the balance — does not add.</p>
              <div className="flex gap-2">
                <Input
                  id="set-balance"
                  type="number"
                  min={0}
                  max={100000000}
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
                  Replace
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjust-balance">Add or take away coins</Label>
              <p className="text-[11px] text-muted-foreground">
                + adds this many to the balance, − takes this many away.
              </p>
              <div className="flex gap-2">
                <Input
                  id="adjust-balance"
                  type="number"
                  min={1}
                  max={100000}
                  value={adjust}
                  onChange={(e) => setAdjust(e.target.value)}
                  placeholder="0"
                />
                <Button
                  variant="outline"
                  onClick={() => adjustCoins.mutate(adjustParsed)}
                  disabled={!adjustValid || adjustCoins.isPending}
                  title="Add coins"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => adjustCoins.mutate(-adjustParsed)}
                  disabled={!adjustValid || adjustCoins.isPending}
                  title="Subtract coins"
                >
                  <Minus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Direct message via OG Bot */}
        <TelegramDmCard
          userId={profile.id}
          chatId={profile.telegram_chat_id}
          tgUsername={profile.telegram_username}
        />

        {/* Audit */}
        <DevBossPanel targetUserId={profile.id} currentBalance={profile.coin_balance ?? 0} />

        <UserAuditTrail userId={profile.id} email={profile.email} />

        {isBoss && <TelegramSignInLog userId={profile.id} />}
      </div>
    </DashboardShell>
  );
}

function TelegramDmCard({
  userId,
  chatId,
  tgUsername,
}: {
  userId: string;
  chatId: number | null;
  tgUsername: string | null;
}) {
  const linked = !!chatId;
  const fallbackToken = userId.replace(/-/g, "").slice(0, 24);
  const [activeToken, setActiveToken] = useState<string>(fallbackToken);
  const connectLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${activeToken}`;
  const [text, setText] = useState("");
  const qc = useQueryClient();
  const sendFn = useServerFn(sendTelegramDm);
  const retryFn = useServerFn(retryTelegramDm);
  const listFn = useServerFn(listTelegramDmsForUser);
  const rotateFn = useServerFn(rotateTelegramLinkToken);
  const pingFn = useServerFn(sendTelegramTestPing);

  const rotate = useMutation({
    mutationFn: async () => rotateFn({ data: { userId } }),
    onSuccess: (res) => {
      setActiveToken(res.token);
      toast.success("Fresh start-link token minted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testPing = useMutation({
    mutationFn: async () => pingFn({ data: { userId } }),
    onSuccess: () => toast.success("Test ping sent ✅"),
    onError: (e: Error) => toast.error(`Ping failed: ${e.message}`),
  });

  const queueQ = useQuery({
    queryKey: ["telegram-dm-queue", userId],
    queryFn: async () => listFn({ data: { userId } }) as Promise<TelegramQueueRow[]>,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["telegram-dm-queue", userId] });

  const send = useMutation({
    mutationFn: async () => sendFn({ data: { userId, text } }),
    onSuccess: () => {
      toast.success("Sent via OG Bot ✅");
      setText("");
      invalidate();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      invalidate();
    },
  });

  const retry = useMutation({
    mutationFn: async (queueId: string) => retryFn({ data: { queueId } }),
    onSuccess: () => {
      toast.success("Retry succeeded ✅");
      invalidate();
    },
    onError: (e: Error) => {
      toast.error(`Retry failed: ${e.message}`);
      invalidate();
    },
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connectLink);
      toast.success("Registration link copied");
    } catch {
      toast.error("Couldn't copy — long-press to copy");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
      <header className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <MessageCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Message via OG Bot</h3>
          <p className="text-xs text-muted-foreground">
            {linked
              ? `Telegram linked${tgUsername ? ` · @${tgUsername}` : ""}. Messages send straight to their DMs.`
              : "User hasn't linked Telegram yet — copy their personal registration link and share it."}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            linked ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
          }`}
        >
          {linked ? "Linked" : "Not linked"}
        </span>
      </header>

      {linked ? (
        <div className="space-y-2">
          <Label htmlFor="og-bot-msg" className="text-xs">
            Message
          </Label>
          <Textarea
            id="og-bot-msg"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message — supports basic HTML (<b>, <i>, <a href>)…"
            rows={4}
            maxLength={4000}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{text.length}/4000</span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testPing.mutate()}
                disabled={testPing.isPending}
              >
                {testPing.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Send test ping
              </Button>
              <Button
                onClick={() => send.mutate()}
                disabled={send.isPending || text.trim().length === 0}
              >
                {send.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send via OG Bot
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Personal registration link
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => rotate.mutate()}
              disabled={rotate.isPending}
            >
              {rotate.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="mr-2 h-4 w-4" />
              )}
              Regenerate token
            </Button>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Input
              readOnly
              value={connectLink}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copy}
              title="Copy link"
              aria-label="Copy registration link"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {activeToken.startsWith("t_")
              ? "Fresh single-use token minted. Share this link — it replaces any previous one."
              : "Send this to the user — once they tap Start in Telegram, OG Bot can DM them."}
          </p>
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent DM attempts
          </Label>
          {queueQ.isFetching ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {queueQ.data && queueQ.data.length > 0 ? (
          <ul className="space-y-2">
            {queueQ.data.map((row) => {
              const StatusIcon =
                row.status === "sent"
                  ? CheckCircle2
                  : row.status === "failed"
                    ? AlertTriangle
                    : Clock;
              const tone =
                row.status === "sent"
                  ? "text-emerald-400"
                  : row.status === "failed"
                    ? "text-red-400"
                    : "text-amber-400";
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-border bg-background/40 p-3 text-xs"
                >
                  <div className="flex items-start gap-2">
                    <StatusIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <span className={`font-semibold ${tone}`}>{row.status}</span>
                        <span>· attempt {row.attempts}</span>
                        <span>· {new Date(row.created_at).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                        {row.body.length > 240 ? `${row.body.slice(0, 240)}…` : row.body}
                      </p>
                      {row.status === "failed" && row.last_error ? (
                        <p className="mt-1 text-[11px] text-red-400">⚠ {row.last_error}</p>
                      ) : null}
                    </div>
                    {row.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 gap-1 text-[11px]"
                        disabled={retry.isPending && retry.variables === row.id}
                        onClick={() => retry.mutate(row.id)}
                      >
                        {retry.isPending && retry.variables === row.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCw className="h-3 w-3" />
                        )}
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">No DM attempts yet.</p>
        )}
      </div>
    </section>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-2 truncate text-base font-semibold">{value}</div>
    </div>
  );
}

function VaultToggleRow({
  userId,
  checked,
  loading,
}: {
  userId: string;
  checked: boolean;
  loading: boolean;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc("set_vault_pass_admin", {
        target_user_id: userId,
        grant_access: next,
        admin_notes: "settings_page_toggle",
      });
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => {
      toast.success(`Vault access ${next ? "granted" : "revoked"}`);
      qc.invalidateQueries({ queryKey: ["admin-user-vault", userId] });
      qc.invalidateQueries({ queryKey: ["admin-user-audit", userId] });
    },
    onError: (e: Error) => {
      const m = e.message.toLowerCase();
      if (m.includes("no active vault credentials"))
        toast.error("No active Vault logins in the pool — add one in Boss Controls first.");
      else if (m.includes("not authorized")) toast.error("Not allowed.");
      else toast.error(e.message);
    },
  });

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center gap-3">
        <KeyRound className="h-5 w-5 text-emerald-500" />
        <div>
          <Label className="text-sm font-medium">OG Vault access</Label>
          <p className="text-xs text-muted-foreground">
            Grants the Vault pass for free — independent of VIP.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {(mut.isPending || loading) && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        <Switch
          checked={checked}
          disabled={mut.isPending || loading}
          onCheckedChange={(v) => mut.mutate(v)}
          aria-label="Toggle OG Vault access"
        />
      </div>
    </div>
  );
}

interface RoleToggleRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  userId: string;
  role: string;
  rpc: "set_vip_admin" | "set_og_bot_admin" | "set_dev_admin" | "set_boss_admin";
  paramKey: "make_vip" | "make_og" | "make_dev" | "make_boss";
  vipExpiry?: boolean;
}

function RoleToggleRow({
  icon,
  title,
  description,
  checked,
  userId,
  role: _role,
  rpc,
  paramKey,
  vipExpiry = false,
}: RoleToggleRowProps) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const expiry = useVipExpiry(userId, vipExpiry && checked);
  const mut = useMutation({
    mutationFn: async (next: boolean) => {
      const args: Record<string, unknown> = {
        target_user_id: userId,
        admin_notes: "settings_page_toggle",
      };
      args[paramKey] = next;
      const { error } = await supabase.rpc(rpc as never, args as never);
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => {
      toast.success(`${title} ${next ? "granted" : "revoked"}`);
      qc.invalidateQueries({ queryKey: ["admin-user-roles", userId] });
      qc.invalidateQueries({ queryKey: ["user-roles", userId] });
      qc.invalidateQueries({ queryKey: ["admin-user-audit", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
      qc.invalidateQueries({ queryKey: ["user-role"] });
    },
    onError: (e: Error) => {
      const m = e.message.toLowerCase();
      if (m.includes("unauthorized")) toast.error("Not allowed.");
      else if (m.includes("target_not_found")) toast.error("User not found.");
      else toast.error(e.message);
    },
  });

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <Label className="text-sm font-medium">{title}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
          {vipExpiry && checked && (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="mt-1 text-xs font-medium text-amber-400 hover:underline"
            >
              {expiry.isLoading ? "…" : formatVipExpiry(expiry.data)} · Adjust expiry
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {mut.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Switch
          checked={checked}
          disabled={mut.isPending}
          onCheckedChange={(v) => (vipExpiry && v ? setDialogOpen(true) : mut.mutate(v))}
          aria-label={`Toggle ${title}`}
        />
      </div>
      {vipExpiry && (
        <VipExpiryDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          userId={userId}
          isVip={checked}
          currentExpiry={expiry.data}
        />
      )}
    </div>
  );
}
