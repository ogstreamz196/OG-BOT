import { useEffect, useState } from "react";
import { Plus, Share, Smartphone } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Set only once the browser confirms the shortcut was added. The popup
// returns on every visit until then ("Not now" hides it for this visit only).
const INSTALLED_KEY = "og:shortcut-installed";

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function markedInstalled(): boolean {
  try { return localStorage.getItem(INSTALLED_KEY) === "1"; } catch { return false; }
}

function markInstalled() {
  try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* storage unavailable */ }
}

export function InstallAppPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Installed Capacitor apps and already-added shortcuts never see this.
    if (Capacitor.isNativePlatform() || isStandalone()) { markInstalled(); return; }
    if (markedInstalled()) return;

    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    nav.getInstalledRelatedApps?.().then((apps) => {
      if (apps.length > 0) { markInstalled(); setOpen(false); }
    }).catch(() => {});

    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    let timer: number | undefined;
    if (ios) {
      setIsIos(true);
      timer = window.setTimeout(() => setOpen(true), 1500);
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setOpen(true);
    };
    const installed = () => { markInstalled(); setDeferred(null); setOpen(false); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  async function install() {
    if (!deferred || installing) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") { markInstalled(); setOpen(false); }
      setDeferred(null);
    } catch { setDeferred(null); }
    finally { setInstalling(false); }
  }

  if (!deferred && !isIos) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-label="Add OG BOT shortcut" className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
            <Smartphone className="h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center">Add OG BOT to your home screen</DialogTitle>
          <DialogDescription className="text-center">
            One tap and OG BOT sits on your home screen like any other app. Nothing to download, no app store, free.
          </DialogDescription>
        </DialogHeader>
        {isIos && !deferred ? (
          <ol className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-foreground">
            <li className="flex items-center gap-2">1. Tap <Share className="h-4 w-4 text-primary" aria-label="Share" /> Share at the bottom of Safari</li>
            <li className="flex items-center gap-2">2. Choose <Plus className="h-4 w-4 text-primary" aria-hidden="true" /> "Add to Home Screen"</li>
            <li>3. Tap "Add" — done</li>
          </ol>
        ) : null}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {deferred && (
            <Button onClick={install} disabled={installing} className="w-full font-semibold">
              <Plus aria-hidden="true" />{installing ? "Adding…" : "Add shortcut"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setOpen(false)} className="w-full text-muted-foreground">
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
