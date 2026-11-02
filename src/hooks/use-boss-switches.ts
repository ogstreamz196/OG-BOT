import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useFreeAccess } from "@/hooks/use-free-access";
import { useSignalsPortal } from "@/hooks/use-signals-portal";
import { listFleet } from "@/lib/telegram-fleet.functions";
import { getSignalsChatState } from "@/lib/signals-chat.functions";

type FleetRow = {
  id: string;
  username: string | null;
  role: string | null;
  enabled: boolean | null;
  webhook_connected: boolean | null;
};

/** The worker fleet in one line: bots switched on, whether their webhooks answer, the copy bot. Pure. */
export function fleetSummary(rows: FleetRow[]) {
  const on = rows.filter((r) => r.enabled);
  const copy = on.find((r) => r.role === "copy");
  return {
    active: on.length,
    total: rows.length,
    webhookOk: on.length > 0 && on.every((r) => r.webhook_connected),
    copyBot: copy?.username ? `@${copy.username.replace(/^@/, "")}` : null,
  };
}

/** "Expires in 3h", "in 2d", "in 25m"; null when there's no end time or it's passed. Pure. */
export function expiresIn(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (!(ms > 0)) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}

/**
 * The Boss's live switches, read from the same places as their own panels
 * (each switch still lives in one place; this only reads): free access, the
 * signals portal, the Telegram worker fleet and the signals demo account.
 * Shared query keys, so a change anywhere shows everywhere.
 */
export function useBossSwitches() {
  const free = useFreeAccess();
  const portal = useSignalsPortal();
  const fleetFn = useServerFn(listFleet);
  const demoFn = useServerFn(getSignalsChatState);
  const fleet = useQuery({
    queryKey: ["telegram-worker-fleet"],
    queryFn: () => fleetFn(),
    staleTime: 60_000,
  });
  const demo = useQuery({
    queryKey: ["signals-chat-state"],
    queryFn: () => demoFn(),
    staleTime: 60_000,
  });
  return {
    free,
    portal,
    fleet: fleet.data ? fleetSummary(fleet.data as FleetRow[]) : null,
    fleetLoading: fleet.isLoading,
    demo: demo.data ?? null,
    demoLoading: demo.isLoading,
  };
}
