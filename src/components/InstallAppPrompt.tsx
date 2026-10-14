import { useEffect, useState } from "react";
import { Plus, Smartphone } from "lucide-react";
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
// iPhones never fire beforeinstallprompt, so they never see this popup.
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
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform() || isStandalone()) { markInstalled(); return; }
    if (markedInstalled()) return;

    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    nav.getInstalledRelatedApps?.().then((apps) => {
      if (apps.length > 0) { markInstalled(); setOpen(false); }
    }).catch(() => {});

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setOpen(true);
    };
    const installed = () => { markInstalled(); setDeferred(null); setOpen(false); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
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

  if (!deferred) return null;
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
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={install} disabled={installing} className="w-full font-semibold">
            <Plus aria-hidden="true" />{installing ? "Adding…" : "Add shortcut"}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)} className="w-full text-muted-foreground">
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
