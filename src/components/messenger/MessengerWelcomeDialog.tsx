import { useEffect, useState } from "react";
import { Lock, Swords, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MessengerMode } from "@/hooks/use-messenger-mode";
import ogBotAsset from "@/assets/ogbot.png.asset.json";

export function greetKey(uid: string | null | undefined) {
  return `og:messenger-greeting:${uid ?? "anon"}`;
}

/**
 * Decide whether the polite greeting should be shown for this user.
 * Asked once per browser session — there is no "remember my choice" opt-out.
 */
export function shouldGreet(uid: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(greetKey(uid)) === "asked") return false;
  } catch {
    return false;
  }
  return true;
}

export function markGreeted(uid: string | null | undefined) {
  try {
    window.sessionStorage.setItem(greetKey(uid), "asked");
  } catch {
    /* storage unavailable — greeting simply shows again */
  }
}

type Props = {
  open: boolean;
  displayName?: string | null;
  currentMode: MessengerMode;
  pending?: boolean;
  onChoose: (mode: MessengerMode) => void;
  onDismiss: () => void;
};

export function MessengerWelcomeDialog({
  open,
  displayName,
  currentMode,
  pending,
  onChoose,
  onDismiss,
}: Props) {
  const [picked, setPicked] = useState<MessengerMode | null>(null);

  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  const name = (displayName ?? "").trim().split(/\s+/)[0] || "friend";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <DialogContent
        // Radix hands focus to the first field behind the dialog on close. On a
        // phone that silently focuses the message box without opening the
        // keyboard, so the user's next real tap does nothing. Leave focus on
        // the page body instead and let the tap own it.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur?.();
        }}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md gap-3 overflow-y-auto bg-card/98 px-3 pb-3 pt-4 shadow-2xl backdrop-blur-xl sm:gap-4 sm:p-6"
      >
        <DialogHeader className="items-center !text-center">
          <img
            src={ogBotAsset.url}
            alt="OG Bot"
            className="mb-0.5 h-11 w-11 rounded-full object-cover ring-2 ring-primary/50 ring-offset-2 ring-offset-card sm:h-14 sm:w-14"
          />
          <DialogTitle className="max-w-[calc(100%-2.5rem)] text-balance text-base font-black leading-tight sm:max-w-none sm:text-2xl">
            Hey {name} — lovely to see you.
          </DialogTitle>
          <DialogDescription className="text-pretty text-xs leading-snug sm:text-sm sm:leading-relaxed">
            Choose where to chat. You can switch any time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 pt-0.5 sm:gap-3 sm:pt-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPicked("loner");
              onChoose("loner");
            }}
            className="group grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-xl border border-primary/40 bg-primary/10 p-2.5 text-left transition-all hover:bg-primary/20 active:scale-[0.99] disabled:opacity-60 sm:gap-3 sm:rounded-2xl sm:p-4"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/20 ring-1 ring-primary/50 sm:h-11 sm:w-11">
              {pending && picked === "loner" ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Lock className="h-5 w-5 text-primary" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black uppercase sm:text-base">Private chat</span>
              <span className="block text-pretty text-[11px] leading-snug text-muted-foreground sm:text-sm">
                Just you &amp; OG Bot. Nobody else sees a word.
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPicked("community");
              onChoose("community");
            }}
            className="group grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-2.5 text-left transition-all hover:bg-cyan-500/20 active:scale-[0.99] disabled:opacity-60 sm:gap-3 sm:rounded-2xl sm:p-4"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cyan-500/20 ring-1 ring-cyan-400/50 sm:h-11 sm:w-11">
              {pending && picked === "community" ? (
                <Loader2 className="h-5 w-5 animate-spin text-cyan-200" />
              ) : (
                <Swords className="h-5 w-5 text-cyan-200" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black uppercase sm:text-base">
                OG Battle Zone
              </span>
              <span className="block text-pretty text-[11px] leading-snug text-muted-foreground sm:text-sm">
                Everyone vs OG Bot — see if you can win a roast battle.
              </span>
            </span>
          </button>
        </div>

        <p className="text-center text-[10px] leading-tight text-muted-foreground/80 sm:text-[11px]">
          You&apos;re currently set to{" "}
          <span className="font-semibold text-foreground">
            {currentMode === "community" ? "OG Battle Zone" : "Private chat"}
          </span>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
