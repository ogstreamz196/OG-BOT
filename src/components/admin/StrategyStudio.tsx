import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus, Save, Trash2, X, Boxes } from "lucide-react";
import { toast } from "sonner";
import { getStrategies, saveStrategies } from "@/lib/signal-strategies.functions";
import {
  newStrategy,
  strategyBrief,
  STRAT_FRAMES,
  MAX_STRATEGIES,
  type SignalStrategy,
  type StratFrame,
} from "@/lib/signal-strategies";
import { SIGNAL_MARKETS, type SignalMarket } from "@/lib/signal-markets";
import type { Tuning } from "@/lib/trade-signal";
import { Button } from "@/components/ui/button";
import { AdminSection } from "./AdminSection";
import { TuningFields, type TuningBounds } from "./TuningFields";
import { StrategyPreview } from "./StrategyPreview";

const MARKET_LABEL: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Bitcoin" };
const FRAME_LABEL: Record<StratFrame, string> = {
  "1H": "1-hour swing",
  "15M": "15-min intraday",
  "5M": "5-min scalp",
  "1M": "1-min scalp",
};

function Editor({
  value,
  bounds,
  defaults,
  saving,
  onSave,
  onCancel,
}: {
  value: SignalStrategy;
  bounds: TuningBounds;
  defaults: Tuning;
  saving: boolean;
  onSave: (s: SignalStrategy) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SignalStrategy>(value);
  const setTuning = (key: keyof Tuning, v: Tuning[keyof Tuning]) =>
    setDraft((d) => ({ ...d, tuning: { ...d.tuning, [key]: v } }));

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-background/50 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-sm font-semibold text-foreground">Name</span>
          <input
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            value={draft.name}
            maxLength={48}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">Market</span>
          <select
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            value={draft.market}
            onChange={(e) => setDraft((d) => ({ ...d, market: e.target.value as SignalMarket }))}
          >
            {SIGNAL_MARKETS.map((m) => (
              <option key={m} value={m}>
                {MARKET_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">Timeframe</span>
          <select
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            value={draft.frame}
            onChange={(e) => setDraft((d) => ({ ...d, frame: e.target.value as StratFrame }))}
          >
            {STRAT_FRAMES.map((f) => (
              <option key={f} value={f}>
                {FRAME_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
          <span className="text-sm font-semibold text-foreground">Note (optional)</span>
          <input
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            value={draft.note}
            maxLength={280}
            placeholder="What this strategy is for"
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          />
        </label>
      </div>

      <div className="my-4 h-px bg-border" />
      <TuningFields draft={draft.tuning} bounds={bounds} onChange={setTuning} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => onSave(draft)} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save strategy
        </Button>
        <Button variant="outline" onClick={() => setDraft({ ...draft, tuning: { ...defaults } })}>
          Reset knobs to defaults
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Strategy studio: named strategy cards with brief details, each editable, with
 * add / delete and a live BTC-chart preview of its projected entry and exits.
 * A strategy is a saved preset of the engine's knobs; previewing runs the real
 * engine on live candles. These are presets to tune and preview for now — they
 * don't drive live signals on their own yet.
 */
export function StrategyStudio({ bounds, defaults }: { bounds: TuningBounds; defaults: Tuning }) {
  const qc = useQueryClient();
  const load = useServerFn(getStrategies);
  const persist = useServerFn(saveStrategies);
  const { data, isLoading } = useQuery({
    queryKey: ["signal-strategies"],
    queryFn: () => load(),
    staleTime: 30_000,
  });
  const items = useMemo(() => data?.strategies ?? [], [data]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (list: SignalStrategy[]) => persist({ data: { strategies: list } }),
    onSuccess: (res) => {
      qc.setQueryData(["signal-strategies"], { strategies: res.strategies });
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't save"),
  });

  const addNew = () => {
    if (items.length >= MAX_STRATEGIES) {
      toast.error(`That's the most strategies (${MAX_STRATEGIES}).`);
      return;
    }
    const s = newStrategy();
    save.mutate([...items, s], { onSuccess: () => setEditingId(s.id) });
  };
  const remove = (id: string) => {
    if (!window.confirm("Delete this strategy? This doesn't touch any trades or learning data."))
      return;
    if (editingId === id) setEditingId(null);
    if (previewId === id) setPreviewId(null);
    save.mutate(items.filter((s) => s.id !== id));
  };
  const saveOne = (s: SignalStrategy) => {
    save.mutate(
      items.map((x) => (x.id === s.id ? s : x)),
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <AdminSection
      icon={<Boxes className="h-4 w-4 text-emerald-400" />}
      title="Strategies"
      subtitle="Named strategies, each a preset of the signal knobs. Edit one, add your own, and preview its next entry and exits on the live chart. Presets for now — they don't post live on their own yet."
      action={
        <Button size="sm" onClick={addNew} disabled={save.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          Add strategy
        </Button>
      }
    >
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading strategies…
        </p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No strategies yet. Add one to start — it begins on the engine's defaults.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-background/40 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-bold text-foreground">
                    {s.name}
                  </p>
                  {s.note ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.note}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Edit"
                    className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-rose-300"
                    onClick={() => remove(s.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {strategyBrief(s).map((b) => (
                  <span
                    key={b}
                    className="rounded-md border border-border bg-background px-2 py-0.5 text-[0.7rem] font-medium text-foreground"
                  >
                    {b}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewId(previewId === s.id ? null : s.id)}
                >
                  {previewId === s.id ? "Hide chart" : "Preview on chart"}
                </Button>
              </div>

              {previewId === s.id ? <StrategyPreview strategy={s} /> : null}
              {editingId === s.id ? (
                <div className="mt-3">
                  <Editor
                    value={s}
                    bounds={bounds}
                    defaults={defaults}
                    saving={save.isPending}
                    onSave={saveOne}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
