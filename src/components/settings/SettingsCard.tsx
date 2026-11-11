import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Each card on the Settings page has its own tint so sections are easy to
 * tell apart. Tints are backgrounds, borders and icons only; text stays
 * white, silver, gold or crimson.
 */
export type CardTone =
  "plain" | "violet" | "rose" | "orange" | "teal" | "gold" | "emerald" | "slate";

const TONES: Record<CardTone, { card: string; chip: string }> = {
  plain: { card: "border-border bg-card", chip: "bg-primary/15 text-primary" },
  violet: {
    card: "border-violet-400/40 border-l-4 border-l-violet-400 bg-gradient-to-br from-violet-500/[0.2] via-card to-card",
    chip: "bg-violet-500/20 text-foreground",
  },
  rose: {
    card: "border-rose-400/40 border-l-4 border-l-rose-400 bg-gradient-to-br from-rose-500/[0.2] via-card to-card",
    chip: "bg-rose-500/20 text-rose-200",
  },
  orange: {
    card: "border-orange-400/40 border-l-4 border-l-orange-400 bg-gradient-to-br from-orange-500/[0.2] via-card to-card",
    chip: "bg-orange-500/20 text-orange-200",
  },
  teal: {
    card: "border-teal-400/40 border-l-4 border-l-teal-400 bg-gradient-to-br from-teal-500/[0.2] via-card to-card",
    chip: "bg-teal-500/20 text-teal-200",
  },
  gold: {
    card: "border-amber-400/45 border-l-4 border-l-amber-400 bg-gradient-to-br from-amber-500/[0.2] via-card to-card",
    chip: "bg-amber-400/20 text-coin",
  },
  emerald: {
    card: "border-emerald-400/40 border-l-4 border-l-emerald-400 bg-gradient-to-br from-emerald-500/[0.2] via-card to-card",
    chip: "bg-emerald-500/20 text-emerald-200",
  },
  slate: {
    card: "border-zinc-300/35 border-l-4 border-l-zinc-300 bg-gradient-to-br from-zinc-400/[0.16] via-card to-card",
    chip: "bg-zinc-400/20 text-foreground",
  },
};

/** One card on the Settings page: icon, title, one-line hint, then content. */
export function SettingsCard({
  icon,
  title,
  hint,
  tone = "plain",
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  tone?: CardTone;
  className?: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section
      className={cn("space-y-4 rounded-2xl border p-4 shadow-card sm:p-5", t.card, className)}
    >
      <header className="flex items-center gap-3">
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", t.chip)}>
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** A labelled row with a control on the right (switch, button, stepper). */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Small pill switcher for picking one of a few options. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-1 rounded-xl border border-border bg-background/40 p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-9 rounded-lg px-2 text-xs font-semibold transition-colors",
              value === o.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
