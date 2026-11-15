import {
  SHOWN_TWEAK_FIELDS,
  ENTRY_STYLES,
  UK_BLOCKS,
  type TweakField,
} from "@/lib/trade-tweaker";
import type { Tuning } from "@/lib/trade-signal";

type Pair = readonly [number, number];
export type TuningBounds = Record<string, unknown> & { scale: readonly [Pair, Pair, Pair] };

const num = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString());

function NumberField({
  field,
  value,
  bound,
  onChange,
}: {
  field: TweakField;
  value: number;
  bound?: Pair;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-foreground">{field.label}</span>
      <span className="text-xs text-muted-foreground">{field.help}</span>
      <input
        type="number"
        className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        value={num(value)}
        step={field.step ?? 1}
        min={field.offable ? 0 : bound?.[0]}
        max={bound?.[1]}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {bound ? (
        <span className="text-[0.7rem] text-muted-foreground">
          {field.offable ? "0 is off · " : ""}range {num(bound[0])}–{num(bound[1])}
        </span>
      ) : null}
    </label>
  );
}

/**
 * The editable grid of every engine knob (TWEAK_FIELDS), shared by the market
 * tuner and the strategy editor. Bounds come from the server (getTweaker); the
 * server re-clamps on save, so these only guide the inputs.
 */
export function TuningFields({
  draft,
  bounds,
  onChange,
}: {
  draft: Tuning;
  bounds: TuningBounds;
  onChange: (key: keyof Tuning, value: Tuning[keyof Tuning]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SHOWN_TWEAK_FIELDS.map((f) => {
        if (f.kind === "number") {
          return (
            <NumberField
              key={f.key}
              field={f}
              value={draft[f.key] as number}
              bound={bounds[f.key] as Pair | undefined}
              onChange={(v) => onChange(f.key, v as Tuning[keyof Tuning])}
            />
          );
        }
        if (f.kind === "entryStyle") {
          return (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-foreground">{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.help}</span>
              <select
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                value={String(draft.entryStyle)}
                onChange={(e) =>
                  onChange("entryStyle", Number(e.target.value) as Tuning["entryStyle"])
                }
              >
                {ENTRY_STYLES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (f.kind === "scale") {
          return (
            <div key={f.key} className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
              <span className="text-sm font-semibold text-foreground">{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.help}</span>
              <div className="mt-1 flex gap-2">
                {([0, 1, 2] as const).map((i) => (
                  <input
                    key={i}
                    type="number"
                    aria-label={`${f.label} ${i + 1}`}
                    className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                    value={num(draft.scale[i])}
                    step={f.step ?? 0.05}
                    min={bounds.scale[i][0]}
                    max={bounds.scale[i][1]}
                    onChange={(e) => {
                      const next = [...draft.scale] as Tuning["scale"];
                      next[i] = Number(e.target.value);
                      onChange("scale", next);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        }
        // blocks
        return (
          <div key={f.key} className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <span className="text-sm font-semibold text-foreground">{f.label}</span>
            <span className="text-xs text-muted-foreground">{f.help}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {UK_BLOCKS.map((b) => {
                const on = draft.skipBlocks.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={on}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      on
                        ? "border-rose-500/60 bg-rose-500/15 text-rose-200"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                    onClick={() =>
                      onChange(
                        "skipBlocks",
                        on
                          ? draft.skipBlocks.filter((x) => x !== b.id)
                          : [...draft.skipBlocks, b.id].sort((a, c) => a - c),
                      )
                    }
                  >
                    {b.label}
                    {on ? " · skipped" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
