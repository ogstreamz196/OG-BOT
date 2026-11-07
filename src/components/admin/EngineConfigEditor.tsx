import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw, Save, Wand2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { getEngineConfig, saveEngineConfig } from "@/lib/engine-config.functions";
import type { EngineConfig } from "@/lib/engine-config";
import { Button } from "@/components/ui/button";
import { AdminSection } from "./AdminSection";

type Loaded = Awaited<ReturnType<typeof getEngineConfig>>;
type Field = { key: string; label: string; help: string; step: number; integer?: boolean };

const GATE_FIELDS: Field[] = [
  {
    key: "minConfidence",
    label: "Min confidence to post",
    help: "Alerts under this % need a winning record first.",
    step: 1,
    integer: true,
  },
  {
    key: "minWinRate",
    label: "Win-rate gate",
    help: "A band that wins less than this (0–1) is held back. 0.42 = 42%.",
    step: 0.01,
  },
  {
    key: "minWinRateTrades",
    label: "Win-rate gate: trades",
    help: "Decided calls needed before the win-rate gate applies.",
    step: 1,
    integer: true,
  },
  {
    key: "badEdge",
    label: "Bad-edge cutoff (R)",
    help: "A record averaging this many R or worse is ruled out. −0.3 default.",
    step: 0.05,
  },
  {
    key: "minRecord",
    label: "Record needed",
    help: "Settled calls before a record can rule a trade out.",
    step: 1,
    integer: true,
  },
  {
    key: "quietMin",
    label: "Quiet valve (mins)",
    help: "If nothing posts for this long, the next alert goes out anyway.",
    step: 1,
    integer: true,
  },
];
const CONC_FIELDS: Field[] = [
  {
    key: "perMarket",
    label: "Max running per market",
    help: "Most alerts one market can have running at once.",
    step: 1,
    integer: true,
  },
  {
    key: "free",
    label: "Free slots (no penalty)",
    help: "This many can run on the base bar before it rises.",
    step: 1,
    integer: true,
  },
  {
    key: "step",
    label: "Confidence per extra",
    help: "Each extra running trade adds this to the confidence needed.",
    step: 1,
    integer: true,
  },
  {
    key: "barMax",
    label: "Concurrency bar cap",
    help: "The concurrency-scaled confidence bar never climbs past this.",
    step: 1,
    integer: true,
  },
  {
    key: "sameSideGapMins",
    label: "Same-side gap (mins)",
    help: "A second same-side alert waits this long after the last.",
    step: 0.5,
  },
  {
    key: "afterStopMins",
    label: "After-stop cooldown (mins)",
    help: "That side sits out this long after a stop loss.",
    step: 0.5,
  },
  {
    key: "sameSetupR",
    label: "Same-setup spacing (R)",
    help: "Entries closer than this share of the risk are the same setup.",
    step: 0.05,
  },
];

const numStr = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString());

function Group({
  title,
  fields,
  values,
  bounds,
  onChange,
}: {
  title: string;
  fields: Field[];
  values: Record<string, number>;
  bounds: Record<string, readonly [number, number]>;
  onChange: (key: string, v: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => {
          const b = bounds[f.key];
          return (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-foreground">{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.help}</span>
              <input
                type="number"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                value={numStr(values[f.key])}
                step={f.step}
                min={b?.[0]}
                max={b?.[1]}
                onChange={(e) => onChange(f.key, Number(e.target.value))}
              />
              {b ? (
                <span className="text-[0.7rem] text-muted-foreground">
                  range {numStr(b[0])}–{numStr(b[1])}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Editable engine-wide settings: the posting gate and the concurrency limits.
 * These were fixed constants; a saved value overrides them and takes effect
 * within a minute. Clamped to safe bounds on the server. Boss only.
 */
export function EngineConfigEditor() {
  const qc = useQueryClient();
  const load = useServerFn(getEngineConfig);
  const persist = useServerFn(saveEngineConfig);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["engine-config"],
    queryFn: () => load(),
    staleTime: 30_000,
  });
  const [draft, setDraft] = useState<EngineConfig | null>(null);
  useEffect(() => {
    if (data) setDraft(data.config);
  }, [data]);

  const dirty = useMemo(
    () => !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.config),
    [draft, data],
  );
  const save = useMutation({
    mutationFn: () => persist({ data: { config: draft } }),
    onSuccess: (res) => {
      qc.setQueryData(["engine-config"], (prev: Loaded | undefined) =>
        prev ? { ...prev, config: res.config } : prev,
      );
      setDraft(res.config);
      toast.success("Engine settings saved. Live within a minute.");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't save"),
  });

  return (
    <AdminSection
      icon={<SlidersHorizontal className="h-4 w-4 text-emerald-400" />}
      title="Engine-wide settings"
      subtitle="The posting gate and the concurrency limits, editable here. A saved value overrides the built-in default and takes effect within a minute; everything is held to safe limits. (Markets, exits and pair checks below are still set in code for now.)"
    >
      {isLoading || !draft ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading…
        </p>
      ) : isError || !data ? (
        <p className="py-8 text-center text-sm text-rose-300">Couldn't load the engine settings.</p>
      ) : (
        <div className="space-y-5">
          <Group
            title="Posting gate"
            fields={GATE_FIELDS}
            values={draft.gate as unknown as Record<string, number>}
            bounds={data.bounds.gate as Record<string, readonly [number, number]>}
            onChange={(k, v) => setDraft((d) => (d ? { ...d, gate: { ...d.gate, [k]: v } } : d))}
          />
          <Group
            title="Concurrency"
            fields={CONC_FIELDS}
            values={draft.concurrency as unknown as Record<string, number>}
            bounds={data.bounds.concurrency as Record<string, readonly [number, number]>}
            onChange={(k, v) =>
              setDraft((d) => (d ? { ...d, concurrency: { ...d.concurrency, [k]: v } } : d))
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save engine settings
            </Button>
            <Button variant="outline" onClick={() => setDraft(data.config)} disabled={!dirty}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Revert
            </Button>
            <Button variant="outline" onClick={() => setDraft(data.defaults)}>
              <Wand2 className="mr-2 h-4 w-4" />
              Reset to defaults
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            These drive the live signals the moment they save. The copy bot copies every signal the
            bot posts, so change them deliberately.
          </p>
        </div>
      )}
    </AdminSection>
  );
}
