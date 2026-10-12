import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "og-track-notify-dismissed";

function supported() {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  // Native app shells (Capacitor) don't support browser notifications.
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !cap?.isNativePlatform?.();
}

async function showReady(title: string, songId: string) {
  const body = `"${title}" is ready — tap to listen.`;
  const url = `/library/${songId}`;
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) {
      await reg.showNotification("🎵 Your track is ready!", { body, icon: "/favicon.ico", tag: songId, data: { url } });
      return;
    }
    const n = new Notification("🎵 Your track is ready!", { body, icon: "/favicon.ico", tag: songId });
    n.onclick = () => {
      window.focus();
      window.location.href = url;
    };
  } catch {
    /* notifications unavailable */
  }
}

/** Asks once if the user wants a device notification, then alerts when a track finishes. */
export function TrackReadyNotifier() {
  const { user } = useAuth();
  const [ask, setAsk] = useState(false);
  const pending = useRef(new Set<string>());

  useEffect(() => {
    if (!user || !supported()) return;
    const ch = supabase
      .channel(`track-ready-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "songs", filter: `user_id=eq.${user.id}` },
        (p) => {
          const row = p.new as { id?: string; status?: string; title?: string; is_variation?: boolean };
          if (!row?.id || row.is_variation) return;
          if (row.status === "pending" || row.status === "processing") {
            pending.current.add(row.id);
            if (Notification.permission === "default" && !localStorage.getItem(DISMISS_KEY)) setAsk(true);
          } else if (row.status === "completed" && pending.current.has(row.id)) {
            pending.current.delete(row.id);
            if (Notification.permission === "granted") void showReady(row.title || "Your track", row.id);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user]);

  if (!ask) return null;
  return (
    <div className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
      <Bell className="h-5 w-5 shrink-0 text-primary" />
      <p className="flex-1 text-sm">Want a notification on this device when your track is finished?</p>
      <Button
        size="sm"
        onClick={async () => {
          setAsk(false);
          const r = await Notification.requestPermission();
          if (r !== "granted") localStorage.setItem(DISMISS_KEY, "1");
        }}
      >
        Notify me
      </Button>
      <button
        aria-label="No thanks"
        className="text-muted-foreground"
        onClick={() => {
          setAsk(false);
          localStorage.setItem(DISMISS_KEY, "1");
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
