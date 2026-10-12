import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "og:install-dismissed-at";
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function wasDismissedRecently(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY));
    return ts > 0 && Number.isFinite(ts) && Date.now() - ts < DISMISS_DAYS * 86400000;
  } catch { return false; }
}

export function InstallAppPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Installed Capacitor apps must never receive a browser install prompt.
    if (Capacitor.isNativePlatform() || isStandalone() || wasDismissedRecently()) return;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const installed = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage unavailable */ }
    setDeferred(null);
  }

  async function install() {
    if (!deferred || installing) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "dismissed") dismiss();
      else setDeferred(null);
    } catch { setDeferred(null); }
    finally { setInstalling(false); }
  }

  if (!deferred) return null;
  return (
    <aside aria-label="Install OG BOT" className="sticky top-0 z-[70] w-full border-b border-primary/30 bg-background text-foreground shadow-card">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2 sm:px-6">
        <Smartphone className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-bold">OG BOT</span>
        <Button onClick={install} disabled={installing} className="shrink-0 px-4 font-semibold">
          <Download aria-hidden="true" />{installing ? "Installing…" : "Install now"}
        </Button>
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss install prompt" title="Dismiss" className="shrink-0 text-muted-foreground">
          <X />
        </Button>
      </div>
    </aside>
  );
}
