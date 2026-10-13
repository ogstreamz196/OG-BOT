import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Stage = 1 | 2 | 3;

interface StageStepperProps {
  current: Stage;
  sampleSeconds: number;
}

/** Three-step progress indicator above the song workspace. */
export function StageStepper({ current, sampleSeconds }: StageStepperProps) {
  const steps: { id: Stage; label: string; sub: string }[] = [
    { id: 1, label: "Lyrics", sub: "Craft the words" },
    { id: 2, label: "Sample", sub: `${sampleSeconds}s preview` },
    { id: 3, label: "Full song", sub: "Final track" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-2 sm:gap-3 sm:p-3">
      {steps.map((s, i) => {
        const done = current > s.id;
        const active = current === s.id;
        return (
          <div
            key={s.id}
            className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:flex-row sm:items-start sm:gap-3 sm:text-left"
          >
            <div
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold transition",
                done && "bg-emerald-500 text-white",
                active && "bg-gradient-brand text-primary-foreground shadow-glow",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <div className="min-w-0 max-w-full">
              <p
                className={cn(
                  "break-words text-xs font-semibold leading-tight sm:text-sm",
                  !active && !done && "text-muted-foreground",
                )}
              >
                {s.label}
              </p>
              <p className="mt-0.5 hidden break-words text-[11px] leading-tight text-muted-foreground min-[380px]:block">
                {s.sub}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
