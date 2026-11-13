import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { useBossSwitches } from "@/hooks/use-boss-switches";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./SettingsCard";

/** The five Boss tasks done most, one tap each. */
const JUMPS = [
  { emoji: "👥", label: "Members & Coins", to: "/admin/users" },
  { emoji: "📈", label: "Trading switches", to: "/admin/signals", tab: "controls" },
  { emoji: "🤖", label: "Telegram Fleet", to: "/admin/signals", tab: "bots" },
  { emoji: "💰", label: "Prices & store", to: "/admin/coins", tab: "prices" },
  { emoji: "⚡", label: "Boss Dashboard", to: "/admin" },
] as const;

/**
 * Boss Switchboard on Settings: which Boss roles this account has, the live
 * state of the main switches (read only here; each is changed in its own
 * place) and one-tap jumps to the most used Boss pages. Your own coins, VIP
 * and roles are changed in Members, like anyone else's.
 */
export function BossControls() {
  const { roles } = useRole();
  const { free, portal, fleet, fleetLoading } = useBossSwitches();
  const isDev = (roles as string[] | undefined)?.includes("dev") ?? false;

  return (
    <SettingsCard
      icon={<ShieldCheck className="h-5 w-5" />}
      title="Boss switchboard"
      hint="Live switches at a glance. Your coins, VIP and roles are changed in Members, like anyone else's."
      tone="violet"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Tag tone="violet">BOSS ACCOUNT</Tag>
          {isDev && <Tag tone="violet">DEV</Tag>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Tag tone={free.enabled ? "amber" : "muted"}>
            Free access: {free.isLoading ? "…" : free.enabled ? "ON" : "OFF"}
          </Tag>
          <Tag tone={portal.enabled ? "emerald" : "muted"}>
            Signals portal: {portal.isLoading ? "…" : portal.enabled ? "ON" : "OFF"}
          </Tag>
          <Tag
            tone={
              fleetLoading || !fleet
                ? "muted"
                : fleet.active && fleet.webhookOk
                  ? "emerald"
                  : fleet.active
                    ? "amber"
                    : "rose"
            }
          >
            Fleet:{" "}
            {fleetLoading
              ? "…"
              : !fleet
                ? "unavailable"
                : fleet.active && fleet.webhookOk
                  ? "Connected"
                  : fleet.active
                    ? "Webhook check"
                    : "Off"}
          </Tag>
        </div>

        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {JUMPS.map((j) => (
            <Link
              key={j.label}
              to={j.to}
              search={"tab" in j ? { tab: j.tab } : {}}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card/80 px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-card"
            >
              <span aria-hidden>{j.emoji}</span>
              <span className="min-w-0 truncate">{j.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}

type Tone = "emerald" | "amber" | "rose" | "violet" | "muted";

function Tag({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold",
        tone === "emerald" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        tone === "amber" && "border-amber-500/40 bg-amber-500/10 text-amber-200",
        tone === "rose" && "border-rose-500/40 bg-rose-500/10 text-rose-300",
        tone === "violet" && "border-violet-500/40 bg-violet-500/10 text-violet-300",
        tone === "muted" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
