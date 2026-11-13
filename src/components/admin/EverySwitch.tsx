import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Send } from "lucide-react";
import { BOSS_SWITCHES, SWITCH_AREAS, type SwitchArea } from "@/lib/boss-switches";

/**
 * "Every switch": one list of every on/off switch the Boss has, what each does
 * on and off, and a tap to where it lives. Read-only: each switch is still
 * flipped in its own place, so nothing here can change a setting by mistake.
 */
export function EverySwitch() {
  const [area, setArea] = useState<SwitchArea>("Everyone");
  const rows = BOSS_SWITCHES.filter((s) => s.area === area);

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">
        {SWITCH_AREAS.map((a) => {
          const n = BOSS_SWITCHES.filter((s) => s.area === a).length;
          const on = a === area;
          return (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setArea(a)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                on
                  ? "border-emerald-400/60 bg-emerald-500/15 text-foreground"
                  : "border-border bg-card/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {a} <span className="opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      <ul className="space-y-2">
        {rows.map((s) => (
          <li key={s.name} className="rounded-xl border border-border bg-card/70 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">{s.name}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{s.where}</div>
              </div>
              {s.to ? (
                <Link
                  to={s.to}
                  search={s.tab ? { tab: s.tab } : {}}
                  hash={s.hash}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
                >
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-400/40 px-2.5 py-1 text-xs font-semibold text-amber-300">
                  <Send className="h-3.5 w-3.5" /> In Telegram
                </span>
              )}
            </div>
            <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2 sm:gap-3">
              <div>
                <dt className="font-bold text-emerald-400">ON</dt>
                <dd className="text-foreground/90">{s.on}</dd>
              </div>
              <div>
                <dt className="font-bold text-rose-400">OFF</dt>
                <dd className="text-muted-foreground">{s.off}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
