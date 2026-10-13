import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { META, type Selections } from "@/lib/library-utils";

interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  subjectName?: string;
  selections: Selections;
  styleText?: string;
  personalDetails: string;
  extraContext: string;
  foulMouth: boolean;
  lyrics: string;
  previewCost: number;
  generating: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ReviewDialog({
  open,
  onOpenChange,
  title,
  subjectName = "",
  selections,
  styleText = "",
  personalDetails,
  extraContext,
  foulMouth,
  lyrics,
  previewCost,
  generating,
  onConfirm,
}: ReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92svh] w-[min(96vw,720px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-white/10 bg-gradient-to-br from-primary/20 via-fuchsia-500/10 to-background px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-black">
            <Sparkles className="h-5 w-5 text-primary" />
            Review your brief
          </DialogTitle>
          <DialogDescription>
            Final check before OG Bot creates the track. Creation and rendering are free.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-5 py-4">
          <div className="space-y-5">
            <section aria-labelledby="rv-track">
              <h3
                id="rv-track"
                className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
              >
                Track
              </h3>
              <div className="mt-2 rounded-xl border border-white/10 bg-card/60 p-3">
                <p className="text-base font-bold">{title.trim() || "Untitled"}</p>
                {subjectName.trim() && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    For <span className="font-semibold text-foreground">{subjectName.trim()}</span>
                  </p>
                )}
                {foulMouth && (
                  <span className="mt-1 inline-block rounded-full border border-destructive/40 bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                    Explicit
                  </span>
                )}
              </div>
            </section>

            <section aria-labelledby="rv-cats">
              <h3
                id="rv-cats"
                className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
              >
                Style
              </h3>
              <div className="mt-2 space-y-2">
                {selections.language && (
                  <div className="rounded-xl border border-white/10 bg-card/60 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {META.language.emoji} {META.language.label}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold">{selections.language}</div>
                  </div>
                )}
                {styleText.trim() && (
                  <div className="rounded-xl border border-white/10 bg-card/60 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      ✨ Style description
                    </div>
                    <p className="mt-0.5 text-sm font-semibold leading-relaxed">
                      {styleText.trim()}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {personalDetails.trim() && (
              <section aria-labelledby="rv-personal">
                <h3
                  id="rv-personal"
                  className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
                >
                  Personal details
                </h3>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-card/60 p-3 font-sans text-sm leading-relaxed">
                  {personalDetails.trim()}
                </pre>
              </section>
            )}

            {extraContext.trim() && (
              <section aria-labelledby="rv-extra">
                <h3
                  id="rv-extra"
                  className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
                >
                  Extra context
                </h3>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-card/60 p-3 font-sans text-sm leading-relaxed">
                  {extraContext.trim()}
                </pre>
              </section>
            )}

            {lyrics.trim() && (
              <section aria-labelledby="rv-lyrics">
                <h3
                  id="rv-lyrics"
                  className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
                >
                  Lyrics
                </h3>
                <p className="mt-2 rounded-xl border border-white/10 bg-background/40 p-3 text-xs text-muted-foreground">
                  🔒 Full-length lyrics are kept private. You'll hear them in your free preview,
                  then unlock the full downloadable track.
                </p>
              </section>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 border-t border-white/10 bg-card/80 px-5 py-3 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Edit
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={generating}
            className="gap-2 bg-gradient-brand text-primary-foreground shadow-glow"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            Confirm &amp; generate · Free
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
