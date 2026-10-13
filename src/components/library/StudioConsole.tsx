import { cn } from "@/lib/utils";

/**
 * Animated VU meter driven by the live generation queue.
 * `load` (0-1) sets how many bars light up and how hard they swing, so the
 * desk visibly reads busier the more jobs are in flight.
 */
export function StudioMeter({
  active,
  bars = 7,
  load = 1,
  className,
}: {
  active: boolean;
  bars?: number;
  /** 0 = idle desk, 1 = queue at capacity. */
  load?: number;
  className?: string;
}) {
  const level = Math.max(0, Math.min(1, load));
  const lit = active ? Math.max(1, Math.round(bars * (0.35 + level * 0.65))) : 0;
  return (
    <div aria-hidden="true" className={cn("flex h-6 items-end gap-[3px]", className)}>
      {Array.from({ length: bars }).map((_, i) => {
        const on = i < lit;
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-full bg-gradient-to-t from-primary/50 to-primary",
              on ? "studio-vu-bar" : "opacity-25",
            )}
            style={{
              height: `${(40 + ((i * 37) % 60)) * (on ? 0.6 + level * 0.4 : 0.5)}%`,
              animationDelay: `${(i * 0.13).toFixed(2)}s`,
              // Busier queue = faster swing.
              animationDuration: `${(1.15 - level * 0.45 + ((i * 7) % 5) / 25).toFixed(2)}s`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Small labelled status LED used on the console rail. */
export function StudioLed({
  label,
  tone = "ok",
  pulse = false,
}: {
  label: string;
  tone?: "ok" | "busy" | "idle" | "alert";
  pulse?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "ok" && "bg-emerald-400 text-emerald-400",
          tone === "busy" && "bg-primary text-primary",
          tone === "idle" && "bg-white/25 text-white/25",
          tone === "alert" && "bg-rose-500 text-rose-500",
          pulse && "studio-led",
        )}
      />
      {label}
    </span>
  );
}
