import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSettings, type AppSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type FieldRule = {
  key: keyof AppSettings;
  label: string;
  help: string;
  unit: string;
  min: number;
  max: number;
};

/**
 * Only settings the server actually enforces. Song creation and lyrics are
 * free (suno-generate / generate-lyrics charge nothing), so their old price
 * fields, the unused variation divisor and the unused sign-up credit field
 * are gone from here on purpose.
 */
const SECTIONS: { title: string; fields: FieldRule[] }[] = [
  {
    title: "What members pay",
    fields: [
      {
        key: "coins_per_full_unlock",
        label: "Unlock a full track",
        help: "Owner's HQ download. Includes the bonus take.",
        unit: "coins",
        min: 0,
        max: 100000,
      },
      {
        key: "coins_per_remake",
        label: "Reveal a bonus take",
        help: "Opening the second version of a song on its own.",
        unit: "coins",
        min: 1,
        max: 1000,
      },
      {
        key: "coins_per_lyric_video",
        label: "Unlock a lyric video",
        help: "One-off charge per song.",
        unit: "coins",
        min: 0,
        max: 10000,
      },
    ],
  },
  {
    title: "Limits",
    fields: [
      {
        key: "songs_per_generation",
        label: "Versions per song",
        help: "How many takes are kept from each generation.",
        unit: "takes",
        min: 1,
        max: 4,
      },
      {
        key: "sample_seconds",
        label: "Free preview length",
        help: "How long locked tracks play before stopping.",
        unit: "seconds",
        min: 5,
        max: 600,
      },
    ],
  },
];

const FIELDS = SECTIONS.flatMap((s) => s.fields);

function validate(rule: FieldRule, raw: string): string | null {
  if (raw.trim() === "") return "Required";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Must be a number";
  if (!Number.isInteger(n)) return "Must be a whole number";
  if (n < rule.min) return `At least ${rule.min}`;
  if (n > rule.max) return `At most ${rule.max}`;
  return null;
}

export function PricingControls() {
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  const saved = (key: keyof AppSettings) => (settings ? String(settings[key]) : "");

  useEffect(() => {
    if (settings)
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])));
  }, [settings]);

  const errors = Object.fromEntries(FIELDS.map((f) => [f.key, validate(f, values[f.key] ?? "")]));
  const hasErrors = Object.values(errors).some(Boolean);
  const changed = FIELDS.filter((f) => !!settings && saved(f.key) !== (values[f.key] ?? ""));

  const save = useMutation({
    mutationFn: async () => {
      if (hasErrors) throw new Error("Fix the highlighted fields first");
      for (const f of changed) {
        const { error } = await supabase
          .from("app_settings")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped jsonb value
          .upsert({ key: f.key, value: Number(values[f.key]) as any }, { onConflict: "key" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(
        `Saved ${changed.length} change${changed.length === 1 ? "" : "s"}. Live for new purchases now.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!settings) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading current prices…
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      {SECTIONS.map((section) => (
        <section key={section.title} className="og-panel rounded-xl border border-border bg-card/60 p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.fields.map((f) => {
              const err = errors[f.key];
              const isChanged = !!settings && saved(f.key) !== (values[f.key] ?? "");
              return (
                <div key={f.key} className="min-w-0">
                  <Label htmlFor={`price-${f.key}`} className="flex items-center gap-2">
                    {f.label}
                    {isChanged && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-primary">
                        Unsaved
                      </span>
                    )}
                  </Label>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      id={`price-${f.key}`}
                      type="number"
                      inputMode="numeric"
                      min={f.min}
                      max={f.max}
                      step={1}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className={cn(err && "border-destructive focus-visible:ring-destructive")}
                      aria-invalid={!!err}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">{f.unit}</span>
                  </div>
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      err ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {err ?? f.help}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-muted-foreground">
        Making a song and writing lyrics are free, so they have no price here. Editing a finished
        track costs 2 coins (fixed in the music engine).
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={!changed.length || save.isPending}
          onClick={() =>
            settings &&
            setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])))
          }
        >
          <RotateCcw className="mr-2 h-4 w-4" /> Undo changes
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || hasErrors || !changed.length}
        >
          {save.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save {changed.length ? `${changed.length} change${changed.length === 1 ? "" : "s"}` : ""}
        </Button>
      </div>
    </div>
  );
}
