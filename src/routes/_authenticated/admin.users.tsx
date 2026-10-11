import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ShieldCheck,
  Search,
  ArrowLeft,
  Users as UsersIcon,
  UserCog,
  Crown,
  Coins,
  Settings as SettingsIcon,
  Bot,
  Plus,
  Minus,
  Pencil,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  X,
  Send,
  Trash2,
} from "lucide-react";
import { deleteUserAccount } from "@/lib/admin-delete-account.functions";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { listUsersPro } from "@/lib/sign-in-tracking.functions";
import { getAllCoinPurchases, type AdminPurchaseTotals } from "@/lib/payments.functions";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { maskDevIdentity } from "@/lib/dev-identity";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AdminEditModeToggle } from "@/components/admin/AdminEditMode";
import { BulkReconcilePanel } from "@/components/admin/BulkReconcilePanel";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  coin_balance: number;
  created_at: string;
}

interface RoleRow {
  user_id: string;
  role: string;
}

type ProUserRow = Awaited<ReturnType<typeof listUsersPro>>[number];

type RoleFilter = "all" | "admin" | "vip" | "og_bot" | "user";
type SortKey = "joined" | "balance" | "name" | "spend" | "buys";

function AdminUsersPage() {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [sort, setSort] = useState<SortKey>("joined");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showBulk, setShowBulk] = useState(false);

  const usersQ = useQuery({
    queryKey: ["admin-users-list"],
    enabled: isAdmin,
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, display_name, coin_balance, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as ProfileRow[]).map((p) => maskDevIdentity(p));
    },
  });

  const rolesQ = useQuery({
    queryKey: ["admin-users-roles"],
    enabled: isAdmin,
    queryFn: async (): Promise<RoleRow[]> => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return (data ?? []) as RoleRow[];
    },
  });

  const proQ = useQuery({
    queryKey: ["admin-users-pro"],
    enabled: isAdmin,
    queryFn: () => listUsersPro({ data: { search: "" } }),
    staleTime: 30_000,
  });
  const proByUser = useMemo(() => {
    const m = new Map<string, ProUserRow>();
    (proQ.data ?? []).forEach((r) => m.set(r.id, r as ProUserRow));
    return m;
  }, [proQ.data]);

  const fetchPurchases = useServerFn(getAllCoinPurchases);
  const purchasesQ = useQuery({
    queryKey: ["admin-users-purchase-totals"],
    enabled: isAdmin,
    queryFn: () => fetchPurchases(),
    staleTime: 60_000,
  });
  const spendByUser: AdminPurchaseTotals = purchasesQ.data?.totals ?? {};

  const rolesByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    (rolesQ.data ?? []).forEach((r) => {
      const arr = map.get(r.user_id) ?? [];
      arr.push(r.role);
      map.set(r.user_id, arr);
    });
    return map;
  }, [rolesQ.data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = usersQ.data ?? [];

    if (roleFilter !== "all") {
      list = list.filter((u) => {
        const r = rolesByUser.get(u.id) ?? [];
        if (roleFilter === "user") return r.length === 0 || (r.length === 1 && r[0] === "user");
        return r.includes(roleFilter);
      });
    }

    if (needle) {
      list = list.filter(
        (u) =>
          (u.email ?? "").toLowerCase().includes(needle) ||
          (u.display_name ?? "").toLowerCase().includes(needle) ||
          u.id.toLowerCase().includes(needle),
      );
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sort === "joined")
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (sort === "balance") cmp = (a.coin_balance ?? 0) - (b.coin_balance ?? 0);
      else if (sort === "name")
        cmp = (a.display_name ?? a.email ?? "").localeCompare(b.display_name ?? b.email ?? "");
      else if (sort === "spend")
        cmp = (spendByUser[a.id]?.totalCoins ?? 0) - (spendByUser[b.id]?.totalCoins ?? 0);
      else if (sort === "buys")
        cmp = (spendByUser[a.id]?.purchaseCount ?? 0) - (spendByUser[b.id]?.purchaseCount ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [usersQ.data, q, roleFilter, rolesByUser, sort, sortDir, spendByUser]);

  if (roleLoading) {
    return (
      <DashboardShell title="Users">
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  const totalUsers = usersQ.data?.length ?? 0;
  const totalCoins = (usersQ.data ?? []).reduce((sum, p) => sum + (p.coin_balance ?? 0), 0);
  const totalVip = (rolesQ.data ?? []).filter((r) => r.role === "vip").length;
  const totalBots = (rolesQ.data ?? []).filter((r) => r.role === "og_bot").length;

  const toggleSort = (key: SortKey) => {
    if (sort === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <DashboardShell title="Users">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Header */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card p-4 sm:flex sm:flex-wrap">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-brand">
                <ShieldCheck className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">User control panel</h2>
                <p className="truncate text-xs text-muted-foreground">
                  Manage members, balances, roles, and audits — all from one place.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AdminEditModeToggle />
              <Link to="/admin">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Admin
                </Button>
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<UserCog className="h-4 w-4" />}
              label="Total users"
              value={totalUsers}
              accent="primary"
            />
            <StatCard
              icon={<Coins className="h-4 w-4" />}
              label="Coins in circulation"
              value={totalCoins}
              accent="coin"
            />
            <StatCard
              icon={<Crown className="h-4 w-4" />}
              label="VIP members"
              value={totalVip}
              accent="amber"
            />
            <StatCard
              icon={<Bot className="h-4 w-4" />}
              label="OG Bots"
              value={totalBots}
              accent="primary"
            />
          </div>

          {/* Bulk tools (collapsible) */}
          <div className="rounded-2xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setShowBulk((s) => !s)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30"
            >
              <div className="flex items-center gap-2">
                <SettingsIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Bulk reconcile & maintenance</span>
              </div>
              {showBulk ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {showBulk && (
              <div className="border-t border-border p-4">
                <BulkReconcilePanel />
              </div>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search email, display name, or id…"
                className="pl-9"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["all", "admin", "vip", "og_bot", "user"] as RoleFilter[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors ${
                    roleFilter === r
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {r === "og_bot" ? "OG bot" : r}
                </button>
              ))}
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {usersQ.data ? `Showing ${filtered.length} of ${totalUsers}` : ""}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            {usersQ.isLoading ? (
              <div className="grid place-items-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length > 0 ? (
              <div
                className="-mx-px overflow-x-auto touch-pan-x touch-pan-y"
                style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain" }}
              >
                <div className="min-w-[640px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <SortableHead
                          label="User"
                          active={sort === "name"}
                          dir={sortDir}
                          onClick={() => toggleSort("name")}
                        />
                        <TableHead>Roles</TableHead>
                        <SortableHead
                          label="Balance"
                          align="right"
                          active={sort === "balance"}
                          dir={sortDir}
                          onClick={() => toggleSort("balance")}
                        />
                        <SortableHead
                          label="Spent"
                          align="right"
                          active={sort === "spend"}
                          dir={sortDir}
                          onClick={() => toggleSort("spend")}
                        />
                        <SortableHead
                          label="Buys"
                          align="right"
                          active={sort === "buys"}
                          dir={sortDir}
                          onClick={() => toggleSort("buys")}
                        />
                        <SortableHead
                          label="Joined"
                          active={sort === "joined"}
                          dir={sortDir}
                          onClick={() => toggleSort("joined")}
                        />
                        <TableHead className="text-right">Quick actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((u) => {
                        const roles = rolesByUser.get(u.id) ?? [];
                        const pro = proByUser.get(u.id);
                        const spend = spendByUser[u.id];
                        return (
                          <UserRow key={u.id} user={u} roles={roles} pro={pro} spend={spend} />
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="grid place-items-center gap-2 py-16 text-muted-foreground">
                <UsersIcon className="h-8 w-8" />
                <p className="text-sm">No users match.</p>
                {(q || roleFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setRoleFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DashboardShell>
    </TooltipProvider>
  );
}

/* ---------- Row ---------- */

function InlineNameEdit({ user }: { user: ProfileRow }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user.display_name ?? "");
  const qc = useQueryClient();

  useEffect(() => {
    if (!editing) setValue(user.display_name ?? "");
  }, [editing, user.display_name]);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = value.trim();
      if (!trimmed) throw new Error("Display name required");
      if (trimmed === (user.display_name ?? "")) return;
      const { error } = await supabase.rpc("admin_update_profile_label", {
        target_user_id: user.id,
        new_display_name: trimmed,
        admin_notes: "users_list_inline_edit",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Name updated");
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={80}
          className="h-7 text-sm"
          aria-label="Edit display name"
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={save.isPending}
          aria-label="Save name"
        >
          {save.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pencil className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setEditing(false)}
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group/name flex w-full min-w-0 items-center gap-1.5 rounded text-left hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      aria-label={`Edit display name for ${user.email ?? "user"}`}
      title="Click to rename"
    >
      <span className="truncate text-sm font-medium">
        {user.display_name ?? user.email?.split("@")[0] ?? "—"}
      </span>
      <Pencil
        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-60"
        aria-hidden
      />
    </button>
  );
}

function UserRow({
  user,
  roles,
  pro,
  spend,
}: {
  user: ProfileRow;
  roles: string[];
  pro?: ProUserRow;
  spend?: { totalCoins: number; purchaseCount: number };
}) {
  const isVip = roles.includes("vip");
  const isOgBot = roles.includes("og_bot");
  const isAdminUser = roles.includes("admin");
  const hasPro = !!(pro && (pro.telegram_chat_id || pro.last_sign_in_at));
  const [spendOpen, setSpendOpen] = useState(false);

  return (
    <>
      <TableRow className="group">
        <TableCell className="max-w-[280px] py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-brand text-xs font-semibold text-primary-foreground">
              {(user.display_name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <InlineNameEdit user={user} />
              <div className="truncate text-xs text-muted-foreground">{user.email ?? "—"}</div>
              {spend && spend.totalCoins > 0 && (
                <button
                  type="button"
                  onClick={() => setSpendOpen((v) => !v)}
                  aria-expanded={spendOpen}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-amber-300 hover:bg-amber-500/20"
                  title="Toggle total spend"
                >
                  <Coins className="h-3 w-3" />
                  Spent {spend.totalCoins.toLocaleString()} · {spend.purchaseCount} buys
                </button>
              )}
              {spendOpen && spend && (
                <div className="mt-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 text-xs text-muted-foreground">
                  Lifetime:{" "}
                  <span className="font-mono tabular-nums text-coin">
                    {spend.totalCoins.toLocaleString()} coins
                  </span>{" "}
                  across {spend.purchaseCount} purchase{spend.purchaseCount === 1 ? "" : "s"}.
                </div>
              )}
            </div>
          </div>
        </TableCell>

        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            {isAdminUser && <RoleChip label="Admin" tone="primary" />}
            {isVip && <RoleChip label="VIP" tone="amber" />}
            {isOgBot && <RoleChip label="Bot" tone="primary-soft" />}
            {!isAdminUser && !isVip && !isOgBot && <RoleChip label="User" tone="muted" />}
          </div>
        </TableCell>

        <TableCell className="text-right">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 font-mono text-sm tabular-nums">
            <Coins className="h-3.5 w-3.5 text-coin" />
            {(user.coin_balance ?? 0).toLocaleString()}
          </div>
        </TableCell>

        <TableCell className="text-right">
          <span className="font-mono text-sm tabular-nums text-amber-300">
            {(spend?.totalCoins ?? 0).toLocaleString()}
          </span>
        </TableCell>

        <TableCell className="text-right">
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {spend?.purchaseCount ?? 0}
          </span>
        </TableCell>

        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(user.created_at).toLocaleDateString()}
        </TableCell>

        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <VipQuickToggle userId={user.id} checked={isVip} />
            <CoinsPopover userId={user.id} balance={user.coin_balance ?? 0} />
            <EditUserPopover user={user} roles={roles} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/admin/users/$userId" params={{ userId: user.id }}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label="Open full user settings"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Open full settings</TooltipContent>
            </Tooltip>
          </div>
        </TableCell>
      </TableRow>
      {hasPro && (
        <TableRow className="border-t-0 hover:bg-transparent">
          <TableCell colSpan={5} className="pt-0 pb-3">
            <div className="ml-12 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {pro!.last_sign_in_at && (
                <span className="rounded-full border border-border/40 bg-background/40 px-2 py-0.5">
                  Last sign-in {new Date(pro!.last_sign_in_at).toLocaleString()}
                  {pro!.sign_in_count ? ` · ${pro!.sign_in_count} total` : ""}
                </span>
              )}
              {pro!.telegram_chat_id ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                  <Send className="h-3 w-3" /> Telegram linked
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5">No Telegram</span>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ---------- Inline actions ---------- */

function VipQuickToggle({ userId, checked }: { userId: string; checked: boolean }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc(
        "set_vip_admin" as never,
        {
          target_user_id: userId,
          make_vip: next,
          admin_notes: "users_list_quick_toggle",
        } as never,
      );
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => {
      toast.success(next ? "VIP granted" : "VIP revoked");
      qc.invalidateQueries({ queryKey: ["admin-users-roles"] });
      qc.invalidateQueries({ queryKey: ["user-role"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-8 items-center rounded-md border border-border bg-background/40 px-2">
          <Crown
            className={`mr-1.5 h-3.5 w-3.5 ${checked ? "text-amber-500" : "text-muted-foreground"}`}
          />
          <Switch
            checked={checked}
            disabled={mut.isPending}
            onCheckedChange={(v) => mut.mutate(v)}
            aria-label="Toggle VIP"
            className="scale-75"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>{checked ? "Revoke VIP" : "Grant VIP"}</TooltipContent>
    </Tooltip>
  );
}

function CoinsPopover({ userId, balance }: { userId: string; balance: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async (delta: number) => {
      if (!Number.isFinite(delta) || delta === 0) throw new Error("Enter an amount");
      if (Math.abs(delta) > 100000) throw new Error("Max ±100,000");
      const { data, error } = await supabase.rpc("mint_coins_admin", {
        target_user_id: userId,
        amount: delta,
        admin_notes: "users_list_quick_grant",
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (newBal, delta) => {
      toast.success(`${delta > 0 ? "+" : ""}${delta} coins · ${newBal}`);
      setAmount("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const n = Number.parseInt(amount, 10);
  const valid = Number.isFinite(n) && n > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Grant or remove coins"
            >
              <Coins className="h-3.5 w-3.5 text-coin" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Grant or remove coins</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Adjust coins</p>
          <span className="text-xs text-muted-foreground">
            current: <span className="font-mono">{balance.toLocaleString()}</span>
          </span>
        </div>
        <Input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => mut.mutate(n)}
            disabled={!valid || mut.isPending}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" /> Grant
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => mut.mutate(-n)}
            disabled={!valid || mut.isPending}
          >
            <Minus className="mr-1 h-4 w-4" /> Remove
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">All adjustments are audited.</p>
      </PopoverContent>
    </Popover>
  );
}

function EditUserPopover({ user, roles }: { user: ProfileRow; roles: string[] }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(user.display_name ?? "");
  const [balance, setBalance] = useState(String(user.coin_balance ?? 0));
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setLabel(user.display_name ?? "");
      setBalance(String(user.coin_balance ?? 0));
    }
  }, [open, user.display_name, user.coin_balance]);

  const isOgBot = roles.includes("og_bot");

  const saveLabel = useMutation({
    mutationFn: async () => {
      const trimmed = label.trim();
      if (!trimmed) throw new Error("Display name required");
      const { error } = await supabase.rpc("admin_update_profile_label", {
        target_user_id: user.id,
        new_display_name: trimmed,
        admin_notes: "users_list_edit",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Label updated");
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBalance = useMutation({
    mutationFn: async () => {
      const nb = Number.parseInt(balance, 10);
      if (!Number.isFinite(nb) || nb < 0) throw new Error("Invalid balance");
      const { error } = await supabase.rpc("set_balance_admin", {
        target_user_id: user.id,
        new_balance: nb,
        admin_notes: "users_list_edit",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Balance set");
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAccount = useServerFn(deleteUserAccount);
  const removeUser = useMutation({
    mutationFn: () => deleteAccount({ data: { userId: user.id } }),
    onSuccess: () => {
      toast.success("Account deleted");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
      qc.invalidateQueries({ queryKey: ["admin-users-roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleOg = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc(
        "set_og_bot_admin" as never,
        {
          target_user_id: user.id,
          make_og: next,
          admin_notes: "users_list_edit",
        } as never,
      );
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => {
      toast.success(next ? "OG Bot granted" : "OG Bot revoked");
      qc.invalidateQueries({ queryKey: ["admin-users-roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Edit user inline</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="flex items-center gap-2">
          <UserCog className="h-4 w-4 text-primary" />
          <p className="truncate text-sm font-semibold">{user.email}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`lbl-${user.id}`} className="text-xs">
            Display name
          </Label>
          <div className="flex gap-1.5">
            <Input
              id={`lbl-${user.id}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
            />
            <Button size="sm" onClick={() => saveLabel.mutate()} disabled={saveLabel.isPending}>
              {saveLabel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`bal-${user.id}`} className="text-xs">
            Set balance
          </Label>
          <div className="flex gap-1.5">
            <Input
              id={`bal-${user.id}`}
              type="number"
              min={0}
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
            <Button size="sm" onClick={() => saveBalance.mutate()} disabled={saveBalance.isPending}>
              {saveBalance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">OG Bot</p>
              <p className="text-xs text-muted-foreground">Bot privileges</p>
            </div>
          </div>
          <Switch
            checked={isOgBot}
            disabled={toggleOg.isPending}
            onCheckedChange={(v) => toggleOg.mutate(v)}
          />
        </div>

        <Link to="/admin/users/$userId" params={{ userId: user.id }} onClick={() => setOpen(false)}>
          <Button variant="outline" size="sm" className="w-full">
            <MoreHorizontal className="mr-1.5 h-3.5 w-3.5" /> Full settings & audit
          </Button>
        </Link>

        <Separator />

        <ConfirmAction
          title={`Delete ${user.display_name ?? user.email ?? "this account"}?`}
          description={
            <p>
              This permanently deletes the account, songs, coins and linked data. This cannot be
              undone.
            </p>
          }
          confirmLabel="Delete account"
          tooltip="Permanently delete this user's account and all their data"
          destructive
          onConfirm={() => removeUser.mutateAsync().then(() => undefined)}
        >
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            disabled={removeUser.isPending}
          >
            {removeUser.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Delete account
          </Button>
        </ConfirmAction>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Atoms ---------- */

function SortableHead({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        {active &&
          (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );
}

function RoleChip({
  label,
  tone,
}: {
  label: string;
  tone: "primary" | "primary-soft" | "amber" | "muted";
}) {
  const styles: Record<typeof tone, string> = {
    primary: "border-primary/40 bg-primary/15 text-primary",
    "primary-soft": "border-primary/30 bg-primary/10 text-primary",
    amber: "border-amber-500/40 bg-amber-500/15 text-amber-400",
    muted: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: "primary" | "coin" | "amber";
}) {
  const ring: Record<typeof accent, string> = {
    primary: "bg-primary/15 text-primary",
    coin: "bg-coin/15 text-coin",
    amber: "bg-amber-500/15 text-amber-400",
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${ring[accent]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold tabular-nums leading-tight">
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}
