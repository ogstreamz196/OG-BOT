import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw, Save, SlidersHorizontal, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { getTweaker, saveTweaker } from "@/lib/signal-tuning.functions";
import { TWEAK_FIELDS, ENTRY_STYLES, UK_BLOCKS, type TweakField } from "@/lib/trade-tweaker";
import type { Tuning } from "@/lib/trade-signal";
import { Button } from "@/components/ui/button";
import { AdminSection } from "./AdminSection";
import { TweakerPinGate } from "./TweakerPinGate";
import { StrategyStudio } from "./StrategyStudio";
import { SignalDataRoom } from "./SignalDataRoom";

type Loaded = Awaited<ReturnType<typeof getTweaker>>;
type MarketRow = Loaded["markets"][number];
type Bounds = Loaded["bounds"];

const num = (n: number, dp = 2) =>
  Number.isInteger(n) ? String(n) : n.toFixed(dp).replace(/\.?0+$/, "");
const pct = (n: number) => `${Math.round(n * 100)}%`;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

function NumberField({
  field,
  value,
  bound,
  onChange,
}: {
  field: TweakField;
  value: number;
  bound?: readonly [number, number];
  onChange: (v: number) => void;
}) {
  const min = field.offable ? 0 : (bound?.[0] ?? undefined);
  const max = bound?.[1];
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-foreground">{field.label}</span>
      <span className="text-xs text-muted-foreground">{field.help}</span>
      <input
        type="number"
        className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        value={num(value, 2)}
        step={field.step ?? 1}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {bound ? (
        <span className="text-[0.7rem] text-muted-foreground">
          {field.offable ? "0 is off · " : ""}range {num(bound[0], 2)}–{num(bound[1], 2)}
        </span>
      ) : null}
    </label>
  );
}

function MarketEditor({
  row,
  bounds,
  defaults,
  onSaved,
}: {
  row: MarketRow;
  bounds: Bounds;
  defaults: Tuning;
  onSaved: () => void;
}) {
  const save = useServerFn(saveTweaker);
  const [draft, setDraft] = useState<Tuning>(row.tuning);
  useEffect(() => setDraft(row.tuning), [row.market, row.tuning]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(row.tuning),
    [draft, row.tuning],
  );
  const mut = useMutation({
    mutationFn: () => save({ data: { market: row.market, tuning: draft } }),
    onSuccess: (res) => {
      setDraft(res.tuning);
      toast.success(`${row.label}: saved. The learner can still move it from here.`);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't save that"),
  });

  const set = (key: keyof Tuning, value: Tuning[keyof Tuning]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/50 p-3 text-sm">
        <span className="font-semibold text-foreground">Learning readout</span>
        {row.current ? (
          <span className="text-muted-foreground">
            last period:{" "}
            <span className="font-semibold text-emerald-400">{pct(row.current.winRate)}</span> win ·{" "}
            {row.current.n} trades · avg {num(row.current.avgR, 2)}R
          </span>
        ) : (
          <span className="text-muted-foreground">no studied period yet</span>
        )}
        <span className="text-muted-foreground">· {row.runs} learning runs</span>
        <span className="text-muted-foreground">· last hand-set {when(row.lastChangeAt)}</span>
      </div>
      {row.lesson ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          {row.lesson}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TWEAK_FIELDS.map((f) => {
          if (f.kind === "number") {
            return (
              <NumberField
                key={f.key}
                field={f}
                value={draft[f.key] as number}
                bound={bounds[f.key as keyof Bounds] as readonly [number, number] | undefined}
                onChange={(v) => set(f.key, v as Tuning[keyof Tuning])}
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
                    set("entryStyle", Number(e.target.value) as Tuning["entryStyle"])
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
                      value={num(draft.scale[i], 2)}
                      step={f.step ?? 0.05}
                      min={bounds.scale[i][0]}
                      max={bounds.scale[i][1]}
                      onChange={(e) => {
                        const next = [...draft.scale] as Tuning["scale"];
                        next[i] = Number(e.target.value);
                        set("scale", next);
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
                        set(
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

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => mut.mutate()} disabled={!dirty || mut.isPending}>
          {mut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save seed
        </Button>
        <Button variant="outline" onClick={() => setDraft(row.tuning)} disabled={!dirty}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Revert
        </Button>
        <Button variant="outline" onClick={() => setDraft(defaults)}>
          <Wand2 className="mr-2 h-4 w-4" />
          Reset to defaults
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A saved value is a starting point, not a lock: the self-learning tuner is free to move it on
        its next run from the results. Every value is held to the engine's own safe limits.
      </p>
    </div>
  );
}

function EngineReadout({ engine }: { engine: Loaded["engine"] }) {
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <p className="mb-2 text-sm font-semibold text-foreground">Markets &amp; gate</p>
        <Row label="Live markets" value={engine.markets.live.join(", ") || "none"} />
        <Row label="Retired" value={engine.markets.retired.join(", ") || "none"} />
        <Row label="Min confidence to post" value={`${engine.gate.minConfidence}%`} />
        <Row
          label="Win-rate gate"
          value={`${Math.round(engine.gate.minWinRate * 100)}% over ${engine.gate.minWinRateTrades} calls`}
        />
        <Row label="Record needed first" value={`${engine.gate.minRecord} filled`} />
      </div>
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <p className="mb-2 text-sm font-semibold text-foreground">Concurrency</p>
        <Row label="Free (no bar penalty)" value={String(engine.concurrency.free)} />
        <Row label="Max running per market" value={String(engine.concurrency.perMarket)} />
        <Row label="Same-side gap" value={`${engine.concurrency.sameSideGapMins} min`} />
        <Row label="After a stop" value={`${engine.concurrency.afterStopMins} min`} />
        <Row label="Same-setup spacing" value={`${engine.concurrency.sameSetupR}R`} />
      </div>
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <p className="mb-2 text-sm font-semibold text-foreground">Exits</p>
        <Row
          label="Profit lock"
          value={`bank ${Math.round(engine.exits.runner.bank * 100)}% / run ${Math.round(engine.exits.runner.run * 100)}%`}
        />
        <Row
          label="Gain lock"
          value={`arm ${Math.round(engine.exits.gainLock.arm * 100)}% · keep ${Math.round(engine.exits.gainLock.keep * 100)}%`}
        />
        <Row
          label="TP trail arms at"
          value={`${Math.round(engine.exits.tpTrail.ARM * 100)}% to TP`}
        />
      </div>
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <p className="mb-2 text-sm font-semibold text-foreground">Pair checks</p>
        <Row label="Agrees (bonus)" value={`+${engine.checks.bonus}`} />
        <Row label="Against (penalty)" value={`−${engine.checks.penalty}`} />
        <Row label="Round-level proximity" value={`${engine.checks.roundNearPct}%`} />
      </div>
    </div>
  );
}

/**
 * TradeTweaker: every learned knob, strategy and the learning data in one
 * place. The per-market Tuning is editable and seeds the engine; the
 * engine-wide settings below are shown so nothing is hidden. Boss only.
 */
export function TradeTweakerPanel() {
  const load = useServerFn(getTweaker);
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["trade-tweaker"],
    queryFn: () => load(),
    staleTime: 30_000,
  });
  const [market, setMarket] = useState<string | null>(null);

  const row = data?.markets.find((m) => m.market === (market ?? data.markets[0]?.market));

  return (
    <TweakerPinGate>
      <AdminSection
        icon={<SlidersHorizontal className="h-4 w-4 text-emerald-400" />}
        title="TradeTweaker · Signal control room"
        subtitle="The control room for the signals: every knob, strategy and the learning data in one place, and where signals are sent and reviewed. Pick a market, change a value and save it. A saved value seeds the engine straight away; the self-learning tuner can still move it from there."
        action={
          data ? (
            <div className="flex flex-wrap gap-1">
              {data.markets.map((m) => (
                <button
                  key={m.market}
                  type="button"
                  onClick={() => setMarket(m.market)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    (market ?? data.markets[0]?.market) === m.market
                      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null
        }
      >
        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading the signal settings…
          </p>
        ) : isError || !data || !row ? (
          <p className="py-12 text-center text-sm text-rose-300">
            Couldn't load the settings. Try again in a moment.
          </p>
        ) : (
          <MarketEditor
            row={row}
            bounds={data.bounds}
            defaults={data.defaults}
            onSaved={() => qc.invalidateQueries({ queryKey: ["trade-tweaker"] })}
          />
        )}
      </AdminSection>

      {data ? <StrategyStudio bounds={data.bounds} defaults={data.defaults} /> : null}

      <SignalDataRoom />

      {data ? (
        <AdminSection
          icon={<SlidersHorizontal className="h-4 w-4 text-muted-foreground" />}
          title="Engine-wide settings"
          subtitle="The rest of the signal machinery, shown so you can see the whole picture. These are set in code for now; tell me which you want to make editable here next."
          muted
        >
          <EngineReadout engine={data.engine} />
        </AdminSection>
      ) : null}
    </TweakerPinGate>
  );
}
