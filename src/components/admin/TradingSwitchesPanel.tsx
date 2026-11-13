import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { LOT_BAND_ORDER, lotBandLabel } from "@/lib/copy-feed";
import {
  getTradingSwitches,
  setTradingSwitch,
  type TradingSwitches,
} from "@/lib/trading-switches.functions";
import { AdminSection } from "./AdminSection";

const KEY = ["boss", "trading-switches"] as const;

type Row = {
  label: string;
  hint: string;
  on: (s: TradingSwitches) => boolean;
  /** The copier card's own action for this switch, given the new state. */
  action: (next: boolean) => string;
};

const COPYING: Row[] = [
  {
    label: "Copying new trades",
    hint: "Off pauses the copiers: no new trades, open ones are still managed and closed.",
    on: (s) => !s.settings.paused,
    action: (v) => (v ? "cs:resume" : "cs:pause"),
  },
  {
    label: "Gold (XAUUSD)",
    hint: "Copy gold signals.",
    on: (s) => (s.settings.markets ?? ["XAUUSD", "BTCUSD"]).includes("XAUUSD"),
    action: () => "cs:mk:XAUUSD",
  },
  {
    label: "Bitcoin (BTCUSD)",
    hint: "Copy Bitcoin signals.",
    on: (s) => (s.settings.markets ?? ["XAUUSD", "BTCUSD"]).includes("BTCUSD"),
    action: () => "cs:mk:BTCUSD",
  },
  {
    label: "Safety stop at the broker",
    hint: "Puts a stop loss on the broker in case the PC goes off. Off: the copier closes trades itself.",
    on: (s) => !!s.settings.useBrokerStop,
    action: (v) => `cs:stop:${v ? "on" : "off"}`,
  },
];

const STRATEGIES: Row[] = [
  {
    label: "High-frequency (HFT)",
    hint: "Faster checks, at least 10 trades running with no cap, lots at the top of your range (gold only above $400).",
    on: (s) => !!s.settings.hft,
    action: (v) => `cs:hft:${v ? "on" : "off"}`,
  },
  {
    label: "Sniper entries",
    hint: "Wait at the last gap or a retest with a limit order, tight stop behind the structure.",
    on: (s) => s.strategies.sniper,
    action: (v) => `es:sniper:${v ? "on" : "off"}`,
  },
  {
    label: "Counter-trend hedges",
    hint: "When open trades all lean one way, look for a reversal on the other side.",
    on: (s) => s.strategies.hedges,
    action: (v) => `es:hedges:${v ? "on" : "off"}`,
  },
  {
    label: "Range hedging",
    hint: "In a sideways market, a buy near the floor and a sell near the ceiling.",
    on: (s) => s.strategies.rangeHedge,
    action: (v) => `es:rangeHedge:${v ? "on" : "off"}`,
  },
  {
    label: "Patterns alongside",
    hint: "Setups the learning has proven post beside the main engine, not only when it waits.",
    on: (s) => s.strategies.patternsAlongside,
    action: (v) => `es:patternsAlongside:${v ? "on" : "off"}`,
  },
];

/**
 * Trading switches on the website: the same switches as the Copy Trader B0T's
 * ⚙️ Copier settings card, saved through the very same code, so flipping one
 * here or in Telegram does exactly the same thing.
 */
export function TradingSwitchesPanel() {
  const qc = useQueryClient();
  const get = useServerFn(getTradingSwitches);
  const set = useServerFn(setTradingSwitch);
  const q = useQuery({ queryKey: KEY, queryFn: () => get() });
  const flip = useMutation({
    mutationFn: (action: string) => set({ data: { action } }),
    onSuccess: (r) => {
      qc.setQueryData(KEY, { settings: r.settings, strategies: r.strategies });
      if (r.ok) toast.success(r.toast);
      else toast(r.toast);
    },
    onError: () => toast.error("Couldn't save that. Try again."),
  });
  const s = q.data;
  const busy = flip.isPending || q.isLoading;

  const rows = (list: Row[]) =>
    s ? (
      <ul className="divide-y divide-border/60">
        {list.map((r) => {
          const on = r.on(s);
          return (
            <li key={r.label} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {r.label}{" "}
                  <span className={on ? "text-emerald-400" : "text-rose-400"}>
                    {on ? "ON" : "OFF"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{r.hint}</p>
              </div>
              <Switch
                checked={on}
                disabled={busy}
                onCheckedChange={(v) => flip.mutate(r.action(v))}
                aria-label={r.label}
              />
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <AdminSection
      icon={<SlidersHorizontal className="h-5 w-5 text-emerald-400" />}
      title="Trading switches"
      subtitle="The same switches as the Copy Trader B0T's ⚙️ Copier settings. Changing one here changes it there too, within seconds."
      action={busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
    >
      {q.isError ? (
        <p className="text-sm text-rose-400">Couldn't load the switches. Refresh to try again.</p>
      ) : !s ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Copying
            </h3>
            {rows(COPYING)}
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Lot size range
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              {s.settings.lotBand
                ? "Bigger lots when the signal's surer; high-frequency uses the top of the range."
                : "No range picked yet: copiers use the bot's own lot. Pick one to set yours."}
            </p>
            <div className="flex flex-wrap gap-2">
              {LOT_BAND_ORDER.map((b) => {
                const on = typeof s.settings.lot !== "number" && s.settings.lotBand === b;
                return (
                  <button
                    key={b}
                    type="button"
                    disabled={busy}
                    onClick={() => flip.mutate(`cs:band:${b}`)}
                    aria-pressed={on}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
                      on
                        ? "border-emerald-400/70 bg-emerald-500/15 text-foreground"
                        : "border-border bg-card/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {lotBandLabel(b)}
                  </button>
                );
              })}
            </div>
            {typeof s.settings.lot === "number" && (
              <p className="mt-2 text-xs text-amber-300">
                A fixed lot of {s.settings.lot} is set (typed in Telegram). Picking a range replaces
                it.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Most trades open at once
            </h3>
            {s.settings.hft ? (
              <p className="text-xs text-muted-foreground">No limit while high-frequency is on.</p>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => flip.mutate("cs:open:-1")}
                  aria-label="One fewer trade"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted disabled:opacity-60"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-[3ch] text-center text-lg font-bold">
                  {s.settings.maxOpen ?? 6}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => flip.mutate("cs:open:1")}
                  aria-label="One more trade"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Strategies (several can run at once)
            </h3>
            {rows(STRATEGIES)}
          </div>
        </div>
      )}
    </AdminSection>
  );
}
