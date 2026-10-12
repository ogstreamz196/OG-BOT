import { Check, Music2 } from "lucide-react";
import type { Variation } from "./types";

/** Paired takes are a free bonus, not a separately charged remake. */
export function VariationsCard({ variations }: { variations: Variation[] }) {
  if (!variations.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Music2 className="h-4 w-4 text-primary" /> Your free second take</h3>
      <p className="text-sm text-muted-foreground">Included when you unlock your first track — 2 tracks for the price of 1.</p>
      <ul className="space-y-2" aria-label="Bonus versions">
        {variations.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{v.title || "Take 2"}</p>
              <p className="text-xs text-muted-foreground">{v.revealed ? "In your library" : "Available after unlocking the first track"}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">{v.revealed && <Check className="h-3 w-3" />} Free</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
