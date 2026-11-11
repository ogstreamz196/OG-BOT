import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Loader2 } from "lucide-react";
import { getMemberActivity } from "@/lib/admin-members.functions";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const coinLabel = (type: string | null) =>
  (type ?? "change").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** A member's recent sign-ins, tracks and coin moves, for the Boss member page. */
export function MemberActivityCard({ userId }: { userId: string }) {
  const fetchActivity = useServerFn(getMemberActivity);
  const q = useQuery({
    queryKey: ["admin-member-activity", userId],
    queryFn: () => fetchActivity({ data: { userId } }),
    staleTime: 30_000,
  });

  return (
    <section className="og-panel space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card">
      <header className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <div>
          <h3 className="font-semibold">Recent activity</h3>
          <p className="text-sm text-muted-foreground">Sign-ins, tracks and coin moves.</p>
        </div>
      </header>

      {q.isLoading ? (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : q.isError ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
          <span className="text-destructive">Couldn't load activity.</span>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="text-xs font-semibold underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      ) : q.data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sign-ins
            </p>
            {q.data.signIns.length === 0 ? (
              <p className="text-xs text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {q.data.signIns.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {[e.device_type, e.os, e.browser].filter(Boolean).join(" · ") || "Sign-in"}
                      {e.is_signup ? " (sign-up)" : ""}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{when(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tracks ({q.data.songCount.toLocaleString()})
            </p>
            {q.data.songs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tracks yet.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {q.data.songs.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <span className="truncate">{s.title || "Untitled"}</span>
                    <span className="shrink-0 capitalize text-muted-foreground">
                      {s.status ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Coin moves
            </p>
            {q.data.coins.length === 0 ? (
              <p className="text-xs text-muted-foreground">No coin history.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {q.data.coins.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span className="truncate">{coinLabel(c.type)}</span>
                    <span
                      className={`shrink-0 font-mono tabular-nums ${
                        c.amount >= 0 ? "text-emerald-300" : "text-destructive"
                      }`}
                    >
                      {c.amount > 0 ? "+" : ""}
                      {c.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
