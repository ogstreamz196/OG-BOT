import { Link } from "@tanstack/react-router";
import { Bot, ChevronRight, Gift, LineChart, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useSetFreeAccess } from "@/hooks/use-free-access";
import { useSetSignalsPortal } from "@/hooks/use-signals-portal";
import { expiresIn, useBossSwitches } from "@/hooks/use-boss-switches";
import { cn } from "@/lib/utils";

const usd = (n: number) =>
  `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PRESETS = [
  { label: "+1h", hours: 1 },
  { label: "+24h", hours: 24 },
  { label: "+7d", hours: 24 * 7 },
] as const;

/**
 * The Boss dashboard's live switches at a glance. Free access and the
 * signals portal are switched right here with the same mutations as their own
 * panels (one place per switch: these call it); the fleet and the demo
 * account link to their tabs.
 */
export function BossCommandBar() {
  const { free, portal, fleet, fleetLoading, demo, demoLoading } = useBossSwitches();
  const setFree = useSetFreeAccess();
  const setPortal = useSetSignalsPortal();
  const until = expiresIn(free.expiresAt);

  const extend = (hours: number) => {
    const from = free.enabled && free.expiresAt ? new Date(free.expiresAt).getTime() : Date.now();
    setFree.mutate({ enabled: true, expiresAt: new Date(from + hours * 3_600_000).toISOString() });
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      {/* Free access: toggle and presets in a popover. */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={pill(free.enabled ? "amber" : "muted")}>
            <Gift className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">
              Free VIP for all:{" "}
              {free.isLoading
                ? "…"
                : free.enabled
                  ? `ON${until ? ` (expires ${until})` : ""}`
                  : "OFF"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3" align="start">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-foreground">Free VIP for everyone</span>
            <Switch
              checked={free.enabled}
              disabled={setFree.isPending}
              onCheckedChange={(on) => setFree.mutate({ enabled: on, expiresAt: null })}
              aria-label="Free VIP for everyone"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant="outline"
                disabled={setFree.isPending}
                onClick={() => extend(p.hours)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Presets switch it on (or add to the time left) and turn it off by themselves.
          </p>
          <Link
            to="/admin/system"
            search={{ tab: "access" }}
            className="block text-xs font-semibold text-foreground underline"
          >
            All free access settings
          </Link>
        </PopoverContent>
      </Popover>

      {/* Signals portal: a switch right on the pill. */}
      <div className={pill(portal.enabled ? "emerald" : "muted")}>
        <LineChart className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          Web Signals: {portal.isLoading ? "…" : portal.enabled ? "LIVE (/signals)" : "HIDDEN"}
        </span>
        <Switch
          checked={portal.enabled}
          disabled={portal.isLoading || setPortal.isPending}
          onCheckedChange={(on) => setPortal.mutate(on)}
          aria-label="Web signals portal"
        />
      </div>

      {/* Telegram worker fleet. */}
      <Link to="/admin/bot" search={{ tab: "telegram" }} className={pill(fleetTone(fleet))}>
        <Bot className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {fleetLoading
            ? "Fleet: …"
            : fleet
              ? `Fleet: ${fleet.active} bot${fleet.active === 1 ? "" : "s"} active · Webhook ${fleet.webhookOk ? "OK" : "check"}`
              : "Fleet: unavailable"}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
      </Link>

      {/* Signals demo account. */}
      <Link to="/admin/bot" search={{ tab: "signals" }} className={pill("muted")}>
        <Wallet className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {demoLoading ? (
            <Loader2 className="inline h-3 w-3 animate-spin" />
          ) : demo?.balance != null ? (
            `Demo balance: ${usd(demo.balance)}${fleet?.copyBot ? ` · Copy bot: ${fleet.copyBot}` : ""}`
          ) : (
            "Demo: not running"
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
      </Link>
    </div>
  );
}

type Tone = "emerald" | "amber" | "rose" | "muted";

function fleetTone(f: ReturnType<typeof useBossSwitches>["fleet"]): Tone {
  if (!f) return "muted";
  if (f.active === 0) return "rose";
  return f.webhookOk ? "emerald" : "amber";
}

function pill(tone: Tone) {
  return cn(
    "flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
    tone === "emerald" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    tone === "amber" && "border-amber-500/40 bg-amber-500/10 text-amber-200",
    tone === "rose" && "border-rose-500/40 bg-rose-500/10 text-rose-300",
    tone === "muted" && "border-border bg-card/80 text-muted-foreground hover:text-foreground",
  );
}
