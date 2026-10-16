import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { claimGuestTracks } from "@/lib/guest-track.functions";
import type { WizardResult } from "@/components/library/CreateNowWizard";

/** The guest (anonymous) account on this device: proof used to claim its tracks. */
export const GUEST_SESSION_KEY = "ogbot.guestSession.v1";
/** The guest's track in progress, so a refresh or return visit picks it up. */
export const GUEST_ACTIVE_KEY = "ogbot.guestActiveTrack.v1";

export type GuestActiveTrack = {
  songId: string;
  title: string;
  /** Orchestration plan, attached server-side once the track is paid. */
  plan: { lyrics: Record<string, unknown>; suno: Record<string, unknown> };
  stage: "checkout" | "cooking";
  /** Wizard answers, so "sign up for free coins" can hand the song to the library. */
  result?: Omit<WizardResult, "titlePromise">;
};

export function readGuestActive(): GuestActiveTrack | null {
  try {
    const raw = localStorage.getItem(GUEST_ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as GuestActiveTrack) : null;
  } catch {
    return null;
  }
}

export function writeGuestActive(track: GuestActiveTrack | null) {
  try {
    if (track) localStorage.setItem(GUEST_ACTIVE_KEY, JSON.stringify(track));
    else localStorage.removeItem(GUEST_ACTIVE_KEY);
  } catch {
    /* storage blocked */
  }
}

export function saveGuestSession(session: Session | null) {
  if (!session?.user?.is_anonymous || !session.refresh_token) return;
  try {
    localStorage.setItem(
      GUEST_SESSION_KEY,
      JSON.stringify({ userId: session.user.id, refreshToken: session.refresh_token }),
    );
  } catch {
    /* storage blocked */
  }
}

/** Keep the stored guest token current: refresh tokens rotate. */
export function useTrackGuestSession() {
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      saveGuestSession(session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
}

let claiming = false;

/** After a real sign-in: move this device's guest tracks into the account. */
export async function claimPendingGuestTracks(queryClient: QueryClient) {
  if (claiming) return;
  let stored: { refreshToken?: string } | null = null;
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  if (!stored?.refreshToken) return;
  claiming = true;
  try {
    const res = await claimGuestTracks({ data: { refreshToken: stored.refreshToken } });
    if (res.ok || res.reason === "guest_not_found") {
      try {
        localStorage.removeItem(GUEST_SESSION_KEY);
      } catch {
        /* ignore */
      }
      writeGuestActive(null);
    }
    if (res.ok && res.moved > 0) {
      toast.success("Masterpiece saved to your permanent library! 🔥");
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    }
  } catch (e) {
    // Keep the token so the next sign-in can try again.
    console.warn("guest track claim failed", e);
  } finally {
    claiming = false;
  }
}
