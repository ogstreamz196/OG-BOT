import { createFileRoute, Navigate, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { adjustCoinsAsBoss } from "@/lib/admin-coins";
import { VipAcknowledgements } from "@/components/admin/VipAcknowledgements";
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Search,
  Users as UsersIcon,
  UserCog,
  Crown,
  Coins,
  Settings as SettingsIcon,
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
  KeyRound,
} from "lucide-react";
import { DeleteAccountDialog } from "@/components/admin/DeleteAccountDialog";
import { BossPasswordInline } from "@/components/admin/BossPasswordCard";
import { VipExpiryDialog, useVipExpiry, formatVipExpiry } from "@/components/admin/VipExpiryDialog";
import { listBossMembers, type BossMember } from "@/lib/admin-members.functions";
import { useIsMobile } from "@/hooks/use-mobile";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AdminEditModeToggle } from "@/components/admin/AdminEditMode";
import { BulkReconcilePanel } from "@/components/admin/BulkReconcilePanel";
import { BossNav } from "@/components/admin/BossNav";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { sendTelegramDm } from "@/lib/telegram-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersRoute,
});

/**
 * /admin/users/$userId (full user settings) is a child of this route, so show
 * it in place of the list when it's open.
 */
function AdminUsersRoute() {
  const childMatches = useChildMatches();
  return childMatches.length > 0 ? <Outlet /> : <AdminUsersPage />;
}

type ProfileRow = BossMember;

type MemberFilter = "all" | "boss" | "vip" | "trial" | "vault" | "dev" | "telegram" | "member";
type SortKey = "joined" | "seen" | "balance" | "name" | "spend" | "buys";

const PAGE_SIZE = 25;

const hasBoss = (roles: string[]) => roles.includes("admin") || roles.includes("boss");
const onTrial = (m: ProfileRow) =>
  !m.roles.includes("vip") &&
  !!m.vip_trial_ends_at &&
  new Date(m.vip_trial_ends_at).getTime() > Date.now();

const FILTERS: { key: MemberFilter; label: string; test: (m: ProfileRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "member", label: "Members", test: (m) => !hasBoss(m.roles) && !m.roles.includes("vip") },
  { key: "vip", label: "VIP", test: (m) => m.roles.includes("vip") },
  { key: "trial", label: "On trial", test: onTrial },
  { key: "vault", label: "Vault", test: (m) => m.has_vault },
  { key: "telegram", label: "Telegram", test: (m) => m.telegram_linked },
  { key: "boss", label: "Boss", test: (m) => hasBoss(m.roles) },
  { key: "dev", label: "Dev", test: (m) => m.roles.includes("dev") },
];

function AdminUsersPage() {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const isMobile = useIsMobile();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [sort, setSort] = useState<SortKey>("joined");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [showBulk, setShowBulk] = useState(false);

  const fetchMembers = useServerFn(listBossMembers);
  const usersQ = useQuery({
    queryKey: ["admin-users-list"],
    enabled: isAdmin,
    queryFn: async (): Promise<ProfileRow[]> => {
      const { members } = await fetchMembers();
      return members.map((m) => maskDevIdentity(m));
    },
    staleTime: 30_000,
  });
  const all = useMemo(() => usersQ.data ?? [], [usersQ.data]);

  const counts = useMemo(() => {
    const c = {} as Record<MemberFilter, number>;
    for (const f of FILTERS) c[f.key] = all.filter(f.test).length;
    return c;
  }, [all]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)?.test ?? (() => true);
    let list = all.filter(test);
    if (needle) {
      const bare = needle.replace(/^@/, "");
      list = list.filter(
        (u) =>
          (u.email ?? "").toLowerCase().includes(needle) ||
          (u.display_name ?? "").toLowerCase().includes(needle) ||
          (u.telegram_username ?? "").toLowerCase().includes(bare) ||
          (u.og_vip_id ?? "").toLowerCase().includes(needle) ||
          u.id.toLowerCase().startsWith(needle),
      );
    }
    const time = (s: string | null) => (s ? new Date(s).getTime() : 0);
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sort === "joined") cmp = time(a.created_at) - time(b.created_at);
      else if (sort === "seen") cmp = time(a.last_sign_in_at) - time(b.last_sign_in_at);
      else if (sort === "balance") cmp = a.coin_balance - b.coin_balance;
      else if (sort === "name")
        cmp = (a.display_name ?? a.email ?? "").localeCompare(b.display_name ?? b.email ?? "");
      else if (sort === "spend") cmp = a.spent_coins - b.spent_coins;
      else if (sort === "buys") cmp = a.purchase_count - b.purchase_count;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [all, q, filter, sort, sortDir]);

  useEffect(() => setPage(0), [q, filter, sort, sortDir]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (roleLoading) {
    return (
      <DashboardShell title="Members">
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  const totalCoins = all.reduce((sum, p) => sum + (p.coin_balance ?? 0), 0);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <DashboardShell title="Members">
        <div className="boss-ui mx-auto max-w-7xl space-y-5">
          <BossNav />
          <VipAcknowledgements />
          <div className="flex justify-end">
            <AdminEditModeToggle />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={<UserCog className="h-4 w-4" />}
              label="Total members"
              value={all.length}
              accent="primary"
            />
            <StatCard
              icon={<Coins className="h-4 w-4" />}
              label="Coins held"
              value={totalCoins}
              accent="coin"
            />
            <StatCard
              icon={<Crown className="h-4 w-4" />}
              label="VIP members"
              value={counts.vip ?? 0}
              accent="amber"
            />
            <StatCard
              icon={<Send className="h-4 w-4" />}
              label="Telegram linked"
              value={counts.telegram ?? 0}
              accent="primary"
            />
          </div>

          {/* Toolbar */}
          <div className="og-panel space-y-3 rounded-2xl border border-border bg-card p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, email, Telegram, VIP ID or account id"
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
              {isMobile ? (
                <select
                  value={`${sort}:${sortDir}`}
                  onChange={(e) => {
                    const [k, d] = e.target.value.split(":");
                    setSort(k as SortKey);
                    setSortDir(d as "asc" | "desc");
                  }}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  aria-label="Sort members"
                >
                  <option value="joined:desc">Newest first</option>
                  <option value="seen:desc">Recently signed in</option>
                  <option value="spend:desc">Top spenders</option>
                  <option value="balance:desc">Most coins</option>
                  <option value="name:asc">Name A to Z</option>
                </select>
              ) : null}
              <div className="text-xs text-muted-foreground sm:ml-auto">
                {usersQ.data ? `${filtered.length.toLocaleString()} found` : ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors ${
                    filter === f.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {f.label}
                  {usersQ.data ? ` (${(counts[f.key] ?? 0).toLocaleString()})` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="og-panel overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            {usersQ.isLoading ? (
              <div className="grid place-items-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : usersQ.isError ? (
              <div className="grid place-items-center gap-2 px-4 py-16 text-center">
                <p className="text-sm font-semibold text-destructive">Couldn't load members.</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {(usersQ.error as Error)?.message || "Something went wrong."}
                </p>
                <Button variant="outline" size="sm" onClick={() => usersQ.refetch()}>
                  Try again
                </Button>
              </div>
            ) : visible.length > 0 ? (
              isMobile ? (
                <ul className="divide-y divide-border">
                  {visible.map((u) => (
                    <MobileUserCard key={u.id} user={u} />
                  ))}
                </ul>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <SortableHead
                            label="Member"
                            active={sort === "name"}
                            dir={sortDir}
                            onClick={() => toggleSort("name")}
                          />
                          <TableHead>Access</TableHead>
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
                        {visible.map((u) => (
                          <UserRow key={u.id} user={u} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )
            ) : (
              <div className="grid place-items-center gap-2 py-16 text-muted-foreground">
                <UsersIcon className="h-8 w-8" />
                <p className="text-sm">No members match.</p>
                {(q || filter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}
            {filtered.length > PAGE_SIZE && !usersQ.isError ? (
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {(safePage * PAGE_SIZE + 1).toLocaleString()} to{" "}
                  {Math.min(filtered.length, (safePage + 1) * PAGE_SIZE).toLocaleString()} of{" "}
                  {filtered.length.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Bulk tools (collapsible, kept out of the way under the list) */}
          <div className="og-panel rounded-2xl border border-border bg-card">
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

function TelegramMessageButton({ user }: { user: ProfileRow }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const sendFn = useServerFn(sendTelegramDm);
  const send = useMutation({
    mutationFn: () => sendFn({ data: { userId: user.id, text } }),
    onSuccess: () => {
      toast.success("Sent via 0G B0T ✅");
      setText("");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Message on Telegram">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] space-y-2">
        <p className="text-sm font-semibold">Message {user.display_name ?? user.email ?? "user"}</p>
        <p className="text-xs text-muted-foreground">Delivered by 0G B0T on Telegram.</p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="Type your message…"
        />
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] text-muted-foreground">{text.length}/4000</span>
          <Button size="sm" onClick={() => send.mutate()} disabled={!text.trim() || send.isPending}>
            {send.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Send
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccessChips({ user }: { user: ProfileRow }) {
  const isBossUser = hasBoss(user.roles);
  const isVip = user.roles.includes("vip");
  const isDev = user.roles.includes("dev");
  const trial = onTrial(user);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {isBossUser && <RoleChip label="Boss" tone="primary" />}
      {isDev && <RoleChip label="Dev" tone="primary-soft" />}
      {isVip && <RoleChip label="VIP" tone="amber" />}
      {trial && <RoleChip label="Trial" tone="amber" />}
      {user.has_vault && <RoleChip label="Vault" tone="amber" />}
      {user.telegram_linked && <RoleChip label="Telegram" tone="primary-soft" />}
      {!isBossUser && !isDev && !isVip && !trial && <RoleChip label="Member" tone="muted" />}
    </div>
  );
}

function UserRow({ user }: { user: ProfileRow }) {
  const isVip = user.roles.includes("vip");
  const hasActivity = !!(user.telegram_linked || user.last_sign_in_at);
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
              {user.og_vip_id ? (
                <div className="truncate font-mono text-[0.7rem] text-amber-300">
                  {user.og_vip_id}
                </div>
              ) : null}
              {user.spent_coins > 0 && (
                <button
                  type="button"
                  onClick={() => setSpendOpen((v) => !v)}
                  aria-expanded={spendOpen}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-amber-300 hover:bg-amber-500/20"
                  title="Toggle total spend"
                >
                  <Coins className="h-3 w-3" />
                  Spent {user.spent_coins.toLocaleString()} · {user.purchase_count} buys
                </button>
              )}
              {spendOpen && (
                <div className="mt-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 text-xs text-muted-foreground">
                  Lifetime:{" "}
                  <span className="font-mono tabular-nums text-coin">
                    {user.spent_coins.toLocaleString()} coins
                  </span>{" "}
                  across {user.purchase_count} purchase{user.purchase_count === 1 ? "" : "s"}.
                </div>
              )}
            </div>
          </div>
        </TableCell>

        <TableCell>
          <AccessChips user={user} />
        </TableCell>

        <TableCell className="text-right">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 font-mono text-sm tabular-nums">
            <Coins className="h-3.5 w-3.5 text-coin" />
            {(user.coin_balance ?? 0).toLocaleString()}
          </div>
        </TableCell>

        <TableCell className="text-right">
          <span className="whitespace-nowrap font-mono text-sm tabular-nums text-amber-300">
            {user.spent_coins.toLocaleString()}
          </span>
        </TableCell>

        <TableCell className="text-right">
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {user.purchase_count}
          </span>
        </TableCell>

        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(user.created_at).toLocaleDateString()}
        </TableCell>

        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            {user.telegram_linked && <TelegramMessageButton user={user} />}
            <VipQuickToggle userId={user.id} checked={isVip} />
            <VaultQuickToggle userId={user.id} checked={user.has_vault} />
            <CoinsPopover userId={user.id} balance={user.coin_balance ?? 0} />
            <EditUserPopover user={user} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/admin/users/$userId" params={{ userId: user.id }}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label="Open full member settings"
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
      {hasActivity && (
        <TableRow className="border-t-0 hover:bg-transparent">
          <TableCell colSpan={7} className="pt-0 pb-3">
            <div className="ml-12 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {user.last_sign_in_at && (
                <span className="rounded-full border border-border/40 bg-background/40 px-2 py-0.5">
                  Last sign-in {new Date(user.last_sign_in_at).toLocaleString()}
                  {user.sign_in_count ? ` · ${user.sign_in_count} total` : ""}
                </span>
              )}
              {user.telegram_linked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                  <Send className="h-3 w-3" /> Telegram linked
                  {user.telegram_username ? ` · @${user.telegram_username}` : ""}
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

/* ---------- Mobile card ---------- */

function MobileUserCard({ user }: { user: ProfileRow }) {
  const isVip = user.roles.includes("vip");
  return (
    <li className="space-y-3 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground">
          {(user.display_name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <InlineNameEdit user={user} />
          <p className="truncate text-xs text-muted-foreground">{user.email ?? "—"}</p>
          {user.og_vip_id ? (
            <p className="truncate font-mono text-[0.7rem] text-amber-300">{user.og_vip_id}</p>
          ) : null}
          <div className="mt-1.5">
            <AccessChips user={user} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border bg-background/40 px-2 py-1.5">
          <p className="text-[0.7rem] uppercase text-muted-foreground">Balance</p>
          <p className="font-mono text-sm font-bold tabular-nums text-coin">
            {(user.coin_balance ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 px-2 py-1.5">
          <p className="text-[0.7rem] uppercase text-muted-foreground">Spent</p>
          <p className="font-mono text-sm font-bold tabular-nums text-amber-300">
            {user.spent_coins.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 px-2 py-1.5">
          <p className="text-[0.7rem] uppercase text-muted-foreground">Joined</p>
          <p className="text-xs font-semibold">{new Date(user.created_at).toLocaleDateString()}</p>
        </div>
      </div>

      {(user.last_sign_in_at || user.telegram_linked) && (
        <p className="text-xs text-muted-foreground">
          {[
            user.last_sign_in_at
              ? `Last sign-in ${new Date(user.last_sign_in_at).toLocaleDateString()}${user.sign_in_count ? ` · ${user.sign_in_count} total` : ""}`
              : null,
            user.telegram_linked
              ? `Telegram${user.telegram_username ? ` @${user.telegram_username}` : " linked"}`
              : "No Telegram",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <VipQuickToggle userId={user.id} checked={isVip} />
        <VaultQuickToggle userId={user.id} checked={user.has_vault} />
      </div>
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          {user.telegram_linked && <TelegramMessageButton user={user} />}
          <CoinsPopover userId={user.id} balance={user.coin_balance ?? 0} />
          <EditUserPopover user={user} />
        </div>
        <Link to="/admin/users/$userId" params={{ userId: user.id }}>
          <Button size="sm" variant="outline" className="h-8">
            Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </li>
  );
}

/* ---------- Inline actions ---------- */

function VipQuickToggle({ userId, checked }: { userId: string; checked: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const expiry = useVipExpiry(userId, checked);
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
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
      qc.invalidateQueries({ queryKey: ["user-role"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 text-sm">
          <Crown className={`h-4 w-4 ${checked ? "text-amber-500" : "text-muted-foreground"}`} />
          <span
            className={`whitespace-nowrap ${checked ? "text-amber-400" : "text-muted-foreground"}`}
          >
            VIP
          </span>
          <Switch
            checked={checked}
            disabled={mut.isPending}
            onCheckedChange={(v) => (v ? setDialogOpen(true) : setConfirmRevoke(true))}
            aria-label="Toggle VIP"
          />
          {checked && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setDialogOpen(true);
              }}
              className="text-xs text-amber-400 underline-offset-2 hover:underline"
              title="Adjust VIP expiry"
            >
              {expiry.isLoading ? "…" : formatVipExpiry(expiry.data)}
            </button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>{checked ? "Revoke VIP or tap date to adjust" : "Grant VIP"}</TooltipContent>
      <VipExpiryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        userId={userId}
        isVip={checked}
        currentExpiry={expiry.data}
      />
      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove VIP?</AlertDialogTitle>
            <AlertDialogDescription>
              This member loses VIP perks straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRevoke(false);
                mut.mutate(false);
              }}
            >
              Remove VIP
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tooltip>
  );
}

function VaultQuickToggle({ userId, checked }: { userId: string; checked: boolean }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc("set_vault_pass_admin", {
        target_user_id: userId,
        grant_access: next,
        admin_notes: "users_list_quick_toggle",
      });
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => {
      toast.success(next ? "Vault access granted" : "Vault access revoked");
      qc.invalidateQueries({ queryKey: ["admin-user-vault", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
    },
    onError: (e: Error) => {
      const m = e.message.toLowerCase();
      if (m.includes("no active vault credentials")) {
        toast.error("No active Vault logins in the pool — add one in Boss Controls first.");
      } else {
        toast.error(e.message);
      }
    },
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 text-sm">
          <KeyRound className={`h-4 w-4 ${checked ? "text-amber-500" : "text-muted-foreground"}`} />
          <span
            className={`whitespace-nowrap ${checked ? "text-amber-400" : "text-muted-foreground"}`}
          >
            Vault
          </span>
          <Switch
            checked={checked}
            disabled={mut.isPending}
            onCheckedChange={(v) => mut.mutate(v)}
            aria-label="Toggle OG Vault access"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {checked ? "Revoke OG Vault access" : "Grant OG Vault access (free, independent of VIP)"}
      </TooltipContent>
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
      const { newBalance, applied } = await adjustCoinsAsBoss(
        userId,
        delta,
        "users_list_quick_grant",
      );
      return { newBal: newBalance, delta: applied };
    },
    onSuccess: ({ newBal, delta }) => {
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
      <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] space-y-3">
        <div>
          <p className="text-sm font-semibold">Add or take away coins</p>
          <p className="text-xs text-muted-foreground">
            The number you type is added to (or taken from) their balance.
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
          Balance now: <span className="font-mono font-semibold">{balance.toLocaleString()}</span>
        </div>
        <Input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="How many coins?"
          aria-label="How many coins to add or take away"
          autoFocus
        />
        {valid && (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>
              Add → balance becomes{" "}
              <span className="font-mono font-semibold text-foreground">
                {(balance + n).toLocaleString()}
              </span>
            </p>
            <p>
              Take away → balance becomes{" "}
              <span className="font-mono font-semibold text-foreground">
                {Math.max(0, balance - n).toLocaleString()}
              </span>
            </p>
          </div>
        )}
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
                <Plus className="mr-1 h-4 w-4" /> Add {valid ? n : ""}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => mut.mutate(-n)}
            disabled={!valid || mut.isPending}
          >
            <Minus className="mr-1 h-4 w-4" /> Take {valid ? n : ""}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Every change is logged.</p>
      </PopoverContent>
    </Popover>
  );
}

function EditUserPopover({ user }: { user: ProfileRow }) {
  const roles = user.roles;
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

  const saveLabel = useMutation({
    mutationFn: async () => {
      const trimmed = label.trim();
      if (!trimmed) throw new Error("Display name required");
      // Unchanged (including the masked dev label) is not saved over the real name.
      if (trimmed === (user.display_name ?? "")) return;
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
      <PopoverContent
        align="end"
        className="max-h-[min(80vh,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-2rem))] space-y-4 overflow-y-auto"
      >
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
            Replace total balance with (overwrites, does not add)
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
              {saveBalance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Replace"}
            </Button>
          </div>
        </div>

        {!roles.some((role) => ["admin", "boss", "dev"].includes(role)) ? (
          <BossPasswordInline
            userId={user.id}
            name={user.display_name ?? user.email ?? "this member"}
          />
        ) : null}

        <Separator />

        <Link to="/admin/users/$userId" params={{ userId: user.id }} onClick={() => setOpen(false)}>
          <Button variant="outline" size="sm" className="w-full">
            <MoreHorizontal className="mr-1.5 h-3.5 w-3.5" /> Full settings & audit
          </Button>
        </Link>

        <Separator />

        {!roles.some((role) => ["admin", "boss", "dev"].includes(role)) ? (
          <DeleteAccountDialog
            userId={user.id}
            name={user.display_name ?? user.email ?? "this account"}
            onDeleted={() => setOpen(false)}
          >
            <Button variant="destructive" size="sm" className="w-full">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete account
            </Button>
          </DeleteAccountDialog>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Boss and Dev accounts can't be deleted here.
          </p>
        )}
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
        className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold uppercase tracking-wide transition-colors ${
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
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm text-muted-foreground">{label}:</div>
        <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${ring[accent]}`}>
          {icon}
        </div>
      </div>
      <div className="mt-1 text-2xl font-normal tabular-nums leading-tight sm:text-3xl">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
