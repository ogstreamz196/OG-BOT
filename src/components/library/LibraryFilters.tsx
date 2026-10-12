import { useRef } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type LibraryFilterMode = "all" | "unlocked" | "locked" | "styles";

function CountBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        "ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums",
        active ? "bg-black/25 text-primary-foreground" : "bg-primary/15 text-primary",
      )}
    >
      {count}
    </span>
  );
}

export function LibraryFilters({
  mode,
  onModeChange,
  styles,
  selectedStyle,
  onStyleChange,
  allCount,
  unlockedCount,
  lockedCount,
  hideAll = false,
}: {
  mode: LibraryFilterMode;
  onModeChange: (mode: LibraryFilterMode) => void;
  styles: string[];
  selectedStyle: string | null;
  onStyleChange: (style: string | null) => void;
  /** Item counts shown as badges next to All / Unlocked. */
  allCount?: number;
  unlockedCount?: number;
  lockedCount?: number;
  /** Community separates full and locked tracks instead of showing a combined All tab. */
  hideAll?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Always show the list from its first track after switching filters.
  const changeMode = (next: LibraryFilterMode) => {
    onModeChange(next);
    requestAnimationFrame(() =>
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  // Filters only help once there is something to filter — keep new creators' view clean.
  if (typeof allCount === "number" && allCount < 3) return null;
  return (
    <div
      ref={rootRef}
      aria-label="Filter tracks"
      className="flex scroll-mt-24 items-center gap-2 overflow-x-auto pb-0.5"
    >
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Show
      </span>
      {!hideAll && (
        <Button
          type="button"
          variant={mode === "all" ? "default" : "ghost"}
          size="sm"
          aria-pressed={mode === "all"}
          onClick={() => changeMode("all")}
          className="h-8 shrink-0 rounded-full px-3 text-xs"
        >
          All
          {typeof allCount === "number" && (
            <CountBadge count={allCount} active={mode === "all"} />
          )}
        </Button>
      )}
      <Button
        type="button"
        variant={mode === "unlocked" ? "default" : "ghost"}
        size="sm"
        aria-pressed={mode === "unlocked"}
        onClick={() => changeMode("unlocked")}
        className="h-8 shrink-0 rounded-full px-3 text-xs"
        title="Full songs you can play right through"
      >
        Full songs
        {typeof unlockedCount === "number" && (
          <CountBadge count={unlockedCount} active={mode === "unlocked"} />
        )}
      </Button>
      {hideAll && (
        <Button
          type="button"
          variant={mode === "locked" ? "default" : "ghost"}
          size="sm"
          aria-pressed={mode === "locked"}
          onClick={() => changeMode("locked")}
          className="h-8 shrink-0 rounded-full px-3 text-xs"
          title="Tracks that still need unlocking"
        >
          Locked
          {typeof lockedCount === "number" && (
            <CountBadge count={lockedCount} active={mode === "locked"} />
          )}
        </Button>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={mode === "styles" ? "default" : "ghost"}
            size="sm"
            aria-pressed={mode === "styles"}
            className="h-8 shrink-0 rounded-full px-3 text-xs"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="max-w-28 truncate">{selectedStyle || "By style"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <p className="px-2 pb-2 text-xs font-bold uppercase text-muted-foreground">
            Choose a style
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {styles.map((style) => (
              <Button
                key={style}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onStyleChange(style);
                  onModeChange("styles");
                }}
                className={cn("w-full justify-between", selectedStyle === style && "text-primary")}
              >
                <span className="truncate">{style}</span>
                {selectedStyle === style && <Check className="h-4 w-4" />}
              </Button>
            ))}
            {styles.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">No styles available yet.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
