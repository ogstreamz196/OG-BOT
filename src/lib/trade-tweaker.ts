// TradeTweaker: the shape of the signal engine's tunable knobs, for the
// Boss-only tuning panel (src/components/admin/TradeTweakerPanel.tsx). Pure and
// browser-safe, so the panel and a test can use it without pulling in server
// code. The knobs themselves live in the learned Tuning (trade-signal.ts),
// stored per market in site_content "signals.learning"; a hand-set value here
// is a seed the walk-forward tuner is still free to move (the Boss, 2026-11-07).
import type { Tuning } from "./trade-signal";

/** How a knob is edited in the panel. */
export type TweakKind = "number" | "scale" | "blocks" | "entryStyle";

export type TweakField = {
  key: keyof Tuning;
  label: string;
  help: string;
  kind: TweakKind;
  /** Step for a plain number field (the panel also clamps to the engine's bounds). */
  step?: number;
  /** A number field that can be switched fully off at 0. */
  offable?: boolean;
  /** Whole numbers only (minutes, confidence, block ids). */
  integer?: boolean;
};

/** The ways in, for the entryStyle select. */
export const ENTRY_STYLES = [
  { value: 0, label: "Engine's choice" },
  { value: 1, label: "Always pullback" },
  { value: 2, label: "Always a break" },
  { value: 3, label: "Always at the price" },
  { value: 4, label: "Always sniper limit" },
] as const;

/** UK time-of-day blocks (ukBlock), for the skip-blocks toggles. */
export const UK_BLOCKS = [
  { id: 0, label: "00–04" },
  { id: 1, label: "04–08" },
  { id: 2, label: "08–12" },
  { id: 3, label: "12–16" },
  { id: 4, label: "16–20" },
  { id: 5, label: "20–24" },
] as const;

/**
 * Every editable knob in the learned Tuning, in the order the panel shows them.
 * The test keeps this in lock-step with the Tuning type so a new knob can't be
 * added to the engine and quietly go missing from TradeTweaker.
 */
export const TWEAK_FIELDS: readonly TweakField[] = [
  {
    key: "minConfidence",
    label: "Minimum confidence",
    help: "The lowest indicator-agreement % a setup needs before it posts. Higher means fewer, cleaner signals.",
    kind: "number",
    step: 1,
    integer: true,
  },
  {
    key: "minVol",
    label: "Minimum liveliness",
    help: "How lively the entry chart must be to trade (ATR now vs its recent average). 0 is off.",
    kind: "number",
    step: 0.05,
    offable: true,
  },
  {
    key: "pullback",
    label: "Pullback depth",
    help: "How far a pullback entry waits back towards the 20 EMA: 0 is the price now, deeper fills less often.",
    kind: "number",
    step: 0.05,
  },
  {
    key: "stopRoom",
    label: "Stop room",
    help: "How much wider the member's stop sits than the engine's own risk.",
    kind: "number",
    step: 0.05,
  },
  {
    key: "stopPad",
    label: "Stop padding",
    help: "ATRs the stop sits beyond the swing it hides behind.",
    kind: "number",
    step: 0.05,
  },
  {
    key: "tpPad",
    label: "Take-profit padding",
    help: "ATRs the take profit sits short of the first level or round number in the way. 0 is off.",
    kind: "number",
    step: 0.05,
    offable: true,
  },
  {
    key: "scale",
    label: "Take-profit sizes",
    help: "The three take-profit distances, as a share of the move the engine measures.",
    kind: "scale",
    step: 0.05,
  },
  {
    key: "beAt",
    label: "Break-even trigger",
    help: "Once a trade is this many times its risk in profit, the stop moves to the entry. 0 is off.",
    kind: "number",
    step: 0.05,
    offable: true,
  },
  {
    key: "runner",
    label: "Runner multiple",
    help: "Bank most at the take profit and let the rest run to this multiple of the take-profit distance. 0 is off.",
    kind: "number",
    step: 0.25,
    offable: true,
  },
  {
    key: "entryStyle",
    label: "Entry style",
    help: "How to get in: the engine's choice, always a pullback, always a break, always at the price now, or always a sniper limit (into the last gap or a retest).",
    kind: "entryStyle",
    integer: true,
  },
  {
    key: "holdFor",
    label: "Hold time (mins)",
    help: "Minutes a filled scalp is given before it's closed on time. 60 is the whole hour (no time stop).",
    kind: "number",
    step: 5,
    integer: true,
  },
  {
    key: "fillWithin",
    label: "Fill window (mins)",
    help: "Minutes a pending entry waits to fill before it's cancelled.",
    kind: "number",
    step: 5,
    integer: true,
  },
  {
    key: "skipBlocks",
    label: "Skip time blocks",
    help: "UK time-of-day blocks to sit out because they've been losing.",
    kind: "blocks",
  },
];

const finite = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Keep only the known Tuning knobs from untrusted panel input, each coerced to
 * the right shape (numbers from strings, arrays for scale and skip-blocks). It
 * never clamps — the server runs the result through safeTuning, which holds the
 * engine's bounds — it only drops junk so safeTuning never sees a bad type.
 */
export function cleanTuningPatch(input: unknown): Partial<Tuning> {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: Partial<Tuning> = {};
  for (const f of TWEAK_FIELDS) {
    const raw = src[f.key];
    if (raw == null) continue;
    if (f.kind === "scale") {
      if (!Array.isArray(raw) || raw.length !== 3) continue;
      const nums = raw.map(finite);
      if (nums.some((n) => n == null)) continue;
      out.scale = [nums[0]!, nums[1]!, nums[2]!];
    } else if (f.kind === "blocks") {
      if (!Array.isArray(raw)) continue;
      const blocks = Array.from(
        new Set(
          raw
            .map(finite)
            .filter((n): n is number => n != null && n >= 0 && n <= 5)
            .map((n) => Math.round(n)),
        ),
      ).sort((a, b) => a - b);
      out.skipBlocks = blocks;
    } else {
      const n = finite(raw);
      if (n == null) continue;
      out[f.key] = (f.integer ? Math.round(n) : n) as never;
    }
  }
  return out;
}
