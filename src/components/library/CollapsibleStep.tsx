import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  step: number;
  title: string;
  /** True once the user has filled this section in. Auto-collapses the body. */
  done: boolean;
  /** Short preview of the filled value shown next to the header when collapsed. */
  summary?: ReactNode;
  /** Force-open on first mount even if not done (default true). */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A numbered step card that auto-collapses once completed. Users can tap the
 * header to re-open it and edit. Keeps the create-song flow uncluttered on
 * mobile while making the completed state legible at a glance.
 */
export function CollapsibleStep({
  step,
  title,
  done,
  summary,
  defaultOpen = true,
  children,
}: Props) {
  // `null` = follow auto behaviour (open until done). Any explicit value
  // (from a tap) wins until the user completes the step again.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? (defaultOpen && !done);

  // When a step flips from incomplete → complete, drop the manual override so
  // it collapses automatically. Re-opening later stays sticky until re-done.
  useEffect(() => {
    if (done) setManual(null);
  }, [done]);

  return (
    <section
      aria-labelledby={`step-${step}-label`}
      className={cn(
        "overflow-hidden rounded-2xl border transition-colors",
        done ? "border-emerald-400/25 bg-emerald-500/[0.04]" : "border-white/10 bg-card/40",
      )}
    >
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        aria-controls={`step-${step}-body`}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] sm:px-5 sm:py-4"
      >
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black tabular-nums transition-colors sm:h-10 sm:w-10",
            done
              ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
              : "bg-primary/15 text-primary ring-1 ring-primary/30",
          )}
          aria-hidden="true"
        >
          {done ? <Check className="h-4 w-4" /> : step}
        </span>

        <div className="min-w-0">
          <div
            id={`step-${step}-label`}
            className="font-bungee text-lg uppercase leading-none tracking-tight sm:text-2xl"
          >
            {title}
          </div>
          {done && !open && summary && (
            <div className="mt-1 truncate text-sm text-muted-foreground">{summary}</div>
          )}
        </div>

        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors sm:text-xs",
            done
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : "border-white/10 bg-white/[0.04] text-muted-foreground",
          )}
        >
          {done && !open ? (
            <>
              <Pencil className="h-3 w-3" /> Edit
            </>
          ) : (
            <>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
              />
              {open ? "Hide" : "Open"}
            </>
          )}
        </span>
      </button>

      <div
        id={`step-${step}-body`}
        hidden={!open}
        className={cn("border-t border-white/5 px-4 pb-5 pt-4 sm:px-6 sm:pb-6", !open && "hidden")}
      >
        {children}
      </div>
    </section>
  );
}
