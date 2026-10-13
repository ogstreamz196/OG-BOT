import { createFileRoute, Link, Navigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Scale,
  Search,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/referrals-audit")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/audit" });
  },
  component: () => null,
});

type AuditUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  referral_code: string | null;
  coin_balance: number;
  created_at: string;
  bound_referrer_id: string | null;
  bound_referrer_name: string | null;
  bound_referrer_email: string | null;
  bound_referrer_code: string | null;
  bound_at: string | null;
  invitees: number;
  earned: number;
};
type LedgerRow = {
  id: string;
  user_id: string;
  amount: number;
  reference: string | null;
  created_at: string;
  referee_id: string | null;
  referrer_name: string | null;
  referee_name: string | null;
};

function copy(text: string, label = "Copied") {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(label),
    () => toast.error("Copy failed"),
  );
}

export function ReferralsAuditPage() {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const auditQ = useQuery({
    queryKey: ["admin-referral-audit", query],
    enabled: isAdmin,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_referral_audit", {
        p_limit: 200,
        p_search: query || undefined,
      });
      if (error) throw error;
      return data as { users: AuditUser[]; ledger: LedgerRow[] };
    },
  });

  const reconQ = useQuery({
    queryKey: ["admin-referral-reconciliation"],
    enabled: isAdmin,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_referral_reconciliation", { p_limit: 200 });
      if (error) throw error;
      return data as {
        rows: Array<{
          referrer_id: string;
          referrer_name: string | null;
          referrer_email: string | null;
          referral_code: string | null;
          total_burned: number;
          burn_count: number;
          expected_payout: number;
          actual_payout: number;
          payout_count: number;
          delta: number;
        }>;
        totals: {
          total_burned: number;
          expected_payout: number;
          actual_payout: number;
          delta: number;
          mismatches: number;
        };
      };
    },
  });

  if (roleLoading) {
    return (
      <DashboardShell title="Referral audit">
        <div className="p-6 text-sm text-muted-foreground">Checking access…</div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  const users = auditQ.data?.users ?? [];
  const ledger = auditQ.data?.ledger ?? [];
  const leaderboard = [...users]
    .filter((u) => (u.invitees ?? 0) > 0 || (u.earned ?? 0) > 0)
    .sort((a, b) => (b.earned ?? 0) - (a.earned ?? 0))
    .slice(0, 25);
  const totalPaid = users.reduce((sum, u) => sum + (u.earned ?? 0), 0);

  return (
    <DashboardShell title="Referral audit">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-2">
          <Link to="/admin">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <ShieldCheck className="h-3 w-3" /> Admin only
          </span>
        </div>

        <section className="rounded-2xl border border-white/10 bg-card/60 p-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search.trim());
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email, display name, or referral code"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
            {query && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setQuery("");
                }}
              >
                Clear
              </Button>
            )}
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-card/60">
          <div className="flex items-center justify-between border-b border-white/5 p-4">
            <h2 className="font-display text-lg font-bold">Users · referral codes & bindings</h2>
            <span className="text-xs text-muted-foreground">{users.length} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-white/5">
                  <th className="p-3">User</th>
                  <th className="p-3">OG Code</th>
                  <th className="p-3">Bound to</th>
                  <th className="p-3">Bound at</th>
                  <th className="p-3 text-right">Invitees</th>
                  <th className="p-3 text-right">Earned</th>
                  <th className="p-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {auditQ.isLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!auditQ.isLoading && users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      No users
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-3">
                      <div className="font-semibold">
                        {u.display_name ?? u.email?.split("@")[0] ?? "—"}
                      </div>
                      <div className="text-muted-foreground">{u.email}</div>
                      <button
                        type="button"
                        className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => copy(u.id, "User ID copied")}
                      >
                        <Copy className="h-2.5 w-2.5" />
                        {u.id.slice(0, 8)}…
                      </button>
                    </td>
                    <td className="p-3">
                      {u.referral_code ? (
                        <button
                          type="button"
                          onClick={() => copy(u.referral_code!, `${u.referral_code} copied`)}
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-background/60 px-2 py-1 font-mono text-[11px] hover:border-primary/50"
                        >
                          {u.referral_code} <Copy className="h-3 w-3" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {u.bound_referrer_id ? (
                        <div>
                          <div className="font-semibold">{u.bound_referrer_name ?? "—"}</div>
                          <div className="text-muted-foreground">
                            {u.bound_referrer_code ?? u.bound_referrer_email}
                          </div>
                        </div>
                      ) : (
                        <span className="rounded-full border border-white/10 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                          Not bound
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {u.bound_at ? new Date(u.bound_at).toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums">{u.invitees}</td>
                    <td className="p-3 text-right tabular-nums text-primary">+{u.earned}</td>
                    <td className="p-3 text-right tabular-nums">{u.coin_balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-card/60">
          <div className="flex items-center justify-between border-b border-white/5 p-4">
            <h2 className="font-display text-lg font-bold">Top OG Leaders · total payouts (6% free · 13% VIP)</h2>
            <span className="text-xs text-muted-foreground">
              {leaderboard.length} leaders · {totalPaid} OG paid total
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-white/5">
                  <th className="p-3">#</th>
                  <th className="p-3">OG Leader</th>
                  <th className="p-3">Code</th>
                  <th className="p-3 text-right">Invitees</th>
                  <th className="p-3 text-right">Total payout (OG)</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      No payouts yet
                    </td>
                  </tr>
                )}
                {leaderboard.map((u, i) => (
                  <tr key={u.id} className="border-b border-white/5">
                    <td className="p-3 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="p-3">
                      <div className="font-semibold">
                        {u.display_name ?? u.email?.split("@")[0] ?? "—"}
                      </div>
                      <div className="text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="p-3 font-mono text-[11px]">{u.referral_code ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">{u.invitees}</td>
                    <td className="p-3 text-right tabular-nums text-primary">+{u.earned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-card/60">
          <div className="flex items-center justify-between border-b border-white/5 p-4">
            <h2 className="font-display text-lg font-bold">Recent referral cashback ledger</h2>
            <span className="text-xs text-muted-foreground">Last 100</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-white/5">
                  <th className="p-3">When</th>
                  <th className="p-3">Referrer (paid)</th>
                  <th className="p-3">Referee (burned)</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3">Reference</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      No cashback events yet
                    </td>
                  </tr>
                )}
                {ledger.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="p-3 text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="p-3">{r.referrer_name ?? "—"}</td>
                    <td className="p-3">{r.referee_name ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums text-primary">+{r.amount}</td>
                    <td className="p-3 truncate font-mono text-[10px] text-muted-foreground">
                      {r.reference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-card/60">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 p-4">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" />
              <h2 className="font-display text-lg font-bold">
                Reconciliation · expected vs paid (6% free / 13% VIP)
              </h2>
            </div>
            {reconQ.data?.totals && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full border border-white/10 bg-background/60 px-2 py-0.5 text-muted-foreground">
                  Burned:{" "}
                  <span className="tabular-nums text-foreground">
                    {reconQ.data.totals.total_burned}
                  </span>
                </span>
                <span className="rounded-full border border-white/10 bg-background/60 px-2 py-0.5 text-muted-foreground">
                  Expected:{" "}
                  <span className="tabular-nums text-foreground">
                    {reconQ.data.totals.expected_payout}
                  </span>
                </span>
                <span className="rounded-full border border-white/10 bg-background/60 px-2 py-0.5 text-muted-foreground">
                  Paid:{" "}
                  <span className="tabular-nums text-foreground">
                    {reconQ.data.totals.actual_payout}
                  </span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                    reconQ.data.totals.mismatches === 0
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border border-amber-500/40 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  {reconQ.data.totals.mismatches === 0 ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> In sync
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3 w-3" /> {reconQ.data.totals.mismatches} mismatch
                      {reconQ.data.totals.mismatches === 1 ? "" : "es"}
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-white/5">
                  <th className="p-3">OG Leader</th>
                  <th className="p-3">Code</th>
                  <th className="p-3 text-right">Referee burns</th>
                  <th className="p-3 text-right">Total burned</th>
                  <th className="p-3 text-right">Expected (est.)</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {reconQ.isLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      Computing…
                    </td>
                  </tr>
                )}
                {!reconQ.isLoading && (reconQ.data?.rows.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      No referral activity yet
                    </td>
                  </tr>
                )}
                {reconQ.data?.rows.map((r) => {
                  const ok = r.delta === 0;
                  return (
                    <tr
                      key={r.referrer_id}
                      className={`border-b border-white/5 ${ok ? "" : "bg-amber-500/[0.04]"}`}
                    >
                      <td className="p-3">
                        <div className="font-semibold">{r.referrer_name ?? "—"}</div>
                        <div className="text-muted-foreground">{r.referrer_email}</div>
                      </td>
                      <td className="p-3 font-mono text-[11px]">{r.referral_code ?? "—"}</td>
                      <td className="p-3 text-right tabular-nums">{r.burn_count}</td>
                      <td className="p-3 text-right tabular-nums">{r.total_burned}</td>
                      <td className="p-3 text-right tabular-nums">{r.expected_payout}</td>
                      <td className="p-3 text-right tabular-nums text-primary">
                        +{r.actual_payout}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums font-semibold ${ok ? "text-emerald-400" : "text-amber-300"}`}
                      >
                        {ok ? "0" : r.delta > 0 ? `+${r.delta}` : r.delta}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-white/5 p-3 text-[10px] text-muted-foreground">
              Expected payout = sum of <span className="font-mono">floor(burn ÷ 10)</span> over each
              referee's generation rows. Δ &gt; 0 means the leader was overpaid relative to recorded
              burns; Δ &lt; 0 means cashback is owed.
            </div>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
