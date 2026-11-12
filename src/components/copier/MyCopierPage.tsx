// A member's own copier (website only): the access the Boss gave them,
// whether the app on their stick is running, their MT5 account and balance as
// last reported, and their own pause for new trades.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pause, Play, Usb } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Button } from "@/components/ui/button";
import { getMyCopier, setMyCopierPause } from "@/lib/copier-keys.functions";

export function MyCopierPage() {
  const load = useServerFn(getMyCopier);
  const pause = useServerFn(setMyCopierPause);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["my-copier"],
    queryFn: () => load(),
    refetchInterval: 15_000,
  });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => pause({ data: { paused } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-copier"] }),
  });
  const c = q.data?.copier ?? null;

  return (
    <DashboardShell title="My copier">
      <div className="mx-auto w-full max-w-xl space-y-4 p-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Usb className="h-6 w-6 text-emerald-400" /> My copier
        </h1>

        {q.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : !c ? (
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            There's no copier access on your account yet. Once it's switched on for you, sign in on
            the app on your stick with this same username and password, and it shows up here.
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <p
              className={
                c.state === "active"
                  ? c.daysLeft <= 3
                    ? "text-lg font-semibold text-amber-400"
                    : "text-lg font-semibold text-emerald-400"
                  : "text-lg font-semibold text-rose-400"
              }
            >
              {c.state === "off"
                ? "Your access is switched off."
                : c.state === "expired"
                  ? "Your access has run out."
                  : `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} of access left`}
            </p>
            {c.state === "active" && (
              <p className="text-sm text-muted-foreground">
                Until {new Date(c.expiresAt).toLocaleDateString("en-GB")}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">The app on your stick</dt>
                <dd className={c.running ? "text-emerald-400" : "text-foreground"}>
                  {c.running ? "Running now" : c.lastSeen ? "Not running" : "Never started"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">MT5 account</dt>
                <dd className="text-foreground">{c.account ?? "Not set up yet"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Balance last seen</dt>
                <dd className="text-foreground">
                  {c.balance != null ? c.balance.toFixed(2) : "–"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">New trades</dt>
                <dd className={c.paused ? "text-amber-400" : "text-foreground"}>
                  {c.paused ? "Paused by you" : "On"}
                </dd>
              </div>
            </dl>

            {c.state === "active" && (
              <Button
                className="w-full"
                variant={c.paused ? "default" : "secondary"}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(!c.paused)}
              >
                {toggle.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : c.paused ? (
                  <Play className="mr-2 h-4 w-4" />
                ) : (
                  <Pause className="mr-2 h-4 w-4" />
                )}
                {c.paused ? "Resume new trades" : "Pause new trades"}
              </Button>
            )}
            {toggle.data && !toggle.data.ok && (
              <p className="text-sm text-rose-400">Couldn't save that. Try again in a minute.</p>
            )}

            <p className="text-xs text-muted-foreground">
              Start and stop the copier from the app on your stick. Pausing here stops new trades;
              the trades already open are still managed for as long as the app is running.
            </p>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
