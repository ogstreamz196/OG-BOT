import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FreshTrackCard } from "@/components/library/FreshTrackCard";
import type { Song } from "@/components/SongCard";

/**
 * The finished-track "masterpiece" player. It takes the place of the creation
 * wizard/cooking popup the moment a track is ready, so the user plays,
 * downloads or edits the track without leaving the page.
 */
export function MasterpieceDialog({
  open,
  onOpenChange,
  song,
  sampleSeconds,
  unlockCost,
  balance,
  autoUnlockPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: Song | null;
  sampleSeconds: number;
  unlockCost: number;
  balance: number;
  autoUnlockPrompt?: boolean;
}) {
  if (!song) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-emerald-400/40 bg-background/95 p-4 sm:max-w-lg sm:p-6">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="font-display text-2xl font-black">
            Your masterpiece is ready
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Play it here, download the full version, or open the studio to edit.
          </p>
        </DialogHeader>
        <FreshTrackCard
          song={song}
          sampleSeconds={sampleSeconds}
          onDismiss={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
