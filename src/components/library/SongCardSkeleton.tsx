import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function SongCardSkeleton({ label }: { label?: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-card/60 p-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <div className="flex gap-2">
            <Skeleton className="h-2 flex-1 rounded-full" />
          </div>
        </div>
        <Skeleton className="hidden h-8 w-20 rounded-lg sm:block" />
      </div>
      {label && (
        <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {label}
        </div>
      )}
    </div>
  );
}
