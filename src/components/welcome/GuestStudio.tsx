import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Download, Flame, Loader2, Pause, Play, Save, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { StripeCheckoutDialog } from "@/components/payments/StripeCheckoutDialog";
import { arePaymentsEnabled, getStripeEnvironment } from "@/lib/stripe";
import { createGuestTrackCheckout, startGuestTrack } from "@/lib/guest-track.functions";
import { reconcileTrackUnlock } from "@/lib/payments.functions";
import { downloadFile } from "@/lib/download-file";
import { claimAudio } from "@/lib/audio-focus";
import { shareTrack } from "@/lib/share-track";
import type { WizardResult } from "@/components/library/CreateNowWizard";
import { buildTrackPlan } from "@/lib/track-plan";
import {
  type GuestActiveTrack,
  readGuestActive,
  saveGuestSession,
  writeGuestActive,
} from "./guest-session";

const OPEN_GUEST_STUDIO = "og:open-guest-studio";
const PRICE_LABEL = "£0.99";
let returnHandled = false;

/** Guests can cook straight away on the website (the phone apps sign up first). */
export function guestCreationAvailable() {
  return typeof window !== "undefined" && !Capacitor.isNativePlatform() && arePaymentsEnabled();
}

/**
 * Stage a guest's song: silent guest account, draft row (no plan yet, so the
 * background worker leaves it alone until it's paid), then open checkout.
 * Returns false when guest creation isn't possible, so the caller can fall
 * back to signing up first.
 */
export async function startGuestCreation(result: WizardResult): Promise<boolean> {
  if (!guestCreationAvailable()) return false;
  try {
    let { data } = await supabase.auth.getSession();
    if (data.session && !data.session.user.is_anonymous) return false;
    if (!data.session) {
      const { data: anon, error } = await supabase.auth.signInAnonymously();
      if (error || !anon.session) return false; // guest sign-ins switched off → sign up first
      data = { session: anon.session };
    }
    saveGuestSession(data.session);
    const { row, plan } = buildTrackPlan(result);
    const { data: staged, error: stageErr } = await supabase
      .from("songs")
      .insert({ ...row, user_id: data.session!.user.id, status: "draft" } as never)
      .select("id")
      .single();
    if (stageErr || !staged) throw new Error(stageErr?.message || "Couldn't save your song");
    writeGuestActive({
      songId: (staged as { id: string }).id,
      title: result.title,
      plan,
      stage: "checkout",
    });
    window.dispatchEvent(new CustomEvent(OPEN_GUEST_STUDIO, { detail: { pay: true } }));
    return true;
  } catch (e) {
    console.warn("guest creation failed", e);
    return false;
  }
}

type GuestSong = {
  id: string;
  title: string | null;
  status: string;
  audio_path: string | null;
  cover_url: string | null;
  error_message: string | null;
};

/**
 * The guest's own studio on the landing page: pay, watch it cook, then play,
 * download and share the full track, with an optional nudge to save it to an
 * account.
 */
export function GuestStudio({ onSave }: { onSave: (title: string) => void }) {
  const [active, setActive] = useState<GuestActiveTrack | null>(null);
  const [open, setOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [song, setSong] = useState<GuestSong | null>(null);

  const startCheckout = useCallback(async (track: GuestActiveTrack) => {
    setPaying(true);
    try {
      const returnUrl = `${window.location.origin}/welcome?guest_track=1&session_id={CHECKOUT_SESSION_ID}`;
      const res = await createGuestTrackCheckout({
        data: { songId: track.songId, returnUrl, environment: getStripeEnvironment() },
      });
      if ("error" in res) throw new Error(res.error);
      setClientSecret(res.clientSecret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout couldn't start");
    } finally {
      setPaying(false);
    }
  }, []);

  // Pick up a track in progress, and open when the wizard hands one over.
  useEffect(() => {
    const t = readGuestActive();
    if (t) setActive(t);
    const on = (e: Event) => {
      const next = readGuestActive();
      setActive(next);
      setOpen(true);
      if (next && (e as CustomEvent<{ pay?: boolean }>).detail?.pay) void startCheckout(next);
    };
    window.addEventListener(OPEN_GUEST_STUDIO, on);
    return () => window.removeEventListener(OPEN_GUEST_STUDIO, on);
  }, [startCheckout]);

  // Back from checkout: confirm the payment, then start cooking. Runs once per
  // page load (not tied to this effect's lifetime) so the result is always saved.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (returnHandled || params.get("guest_track") !== "1" || !sessionId) return;
    returnHandled = true;
    const clean = new URL(window.location.href);
    clean.searchParams.delete("guest_track");
    clean.searchParams.delete("session_id");
    window.history.replaceState(null, "", clean.toString());
    const track = readGuestActive();
    if (!track) return;
    setActive(track);
    setOpen(true);
    setConfirming(true);
    void (async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const r = await reconcileTrackUnlock({
            data: { sessionId, environment: getStripeEnvironment() },
          });
          if ("status" in r && r.status === "unlocked") {
            if (await startGuestTrackSafely(track)) {
              const next = { ...track, stage: "cooking" as const };
              writeGuestActive(next);
              setActive(next);
            }
            break;
          }
          if ("error" in r) throw new Error(r.error);
        } catch (e) {
          if (attempt === 7) toast.error(e instanceof Error ? e.message : "Payment check failed");
        }
        await new Promise((res) => setTimeout(res, 2500));
      }
      setConfirming(false);
    })();
  }, []);

  // Watch the track while it cooks (survives refreshes via localStorage).
  useEffect(() => {
    if (!active || active.stage !== "cooking") return;
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from("songs")
        .select("id, title, status, audio_path, cover_url, error_message")
        .eq("id", active.songId)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        // Moved into an account or gone: nothing left to show here.
        writeGuestActive(null);
        setActive(null);
        return;
      }
      setSong(data as GuestSong);
      if ((data as GuestSong).status === "completed" && !open) {
        toast.success(`"${data.title || active.title}" is ready 🔥`, {
          action: { label: "Play", onClick: () => setOpen(true) },
        });
      }
    };
    void check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.songId, active?.stage]);

  if (!active) return null;
  const title = song?.title || active.title || "Your track";
  const done = song?.status === "completed";
  const failed = song?.status === "failed";

  return (
    <>
      {/* Portalled: the landing page's main has a transform, which would pin a
          fixed button to the page instead of the screen. */}
      {!open && typeof document !== "undefined"
        ? createPortal(
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-40 inline-flex min-h-12 whitespace-nowrap -translate-x-1/2 items-center gap-2 rounded-full border border-destructive/50 bg-card/95 px-5 text-sm font-black uppercase tracking-wide text-foreground shadow-glow-danger backdrop-blur-xl"
            >
              {active.stage === "checkout" ? (
                <>
                  <Flame className="h-4 w-4 text-destructive" /> Finish your track · {PRICE_LABEL}
                </>
              ) : done ? (
                <>
                  <Play className="h-4 w-4 text-destructive" /> Play your track
                </>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-destructive" /> Your track is
                  cooking
                </>
              )}
            </button>,
            document.body,
          )
        : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-md overflow-y-auto border-destructive/30 bg-card">
          {active.stage === "checkout" ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-destructive/40 bg-destructive/10">
                {confirming ? (
                  <Loader2 className="h-7 w-7 animate-spin text-destructive" />
                ) : (
                  <Flame className="h-7 w-7 text-destructive" />
                )}
              </div>
              <DialogTitle className="font-display text-2xl font-black">
                {confirming ? "Confirming payment…" : "Cook your master track"}
              </DialogTitle>
              <DialogDescription className="text-sm text-foreground/85">
                <span className="font-bold text-foreground">{title}</span> — full-length track with
                real vocals. Play it, download the MP3 and share it. No account needed.
              </DialogDescription>
              {!confirming ? (
                <button
                  type="button"
                  disabled={paying}
                  onClick={() => void startCheckout(active)}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-destructive px-5 text-sm font-black uppercase tracking-wide text-destructive-foreground shadow-glow-danger disabled:opacity-60"
                >
                  {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Pay {PRICE_LABEL} &amp; cook
                </button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Secure card checkout · Apple Pay · Google Pay
              </p>
            </div>
          ) : done && song ? (
            <div className="space-y-4">
              <DialogTitle className="sr-only">{title} is ready</DialogTitle>
              <GuestTrackPlayer song={song} title={title} />
              <SaveToLibraryCard onSave={() => onSave(title)} />
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-full border border-destructive/40 bg-destructive/10">
                <Flame className="h-9 w-9 animate-pulse text-destructive" />
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full border border-destructive/30"
                />
              </div>
              <DialogTitle className="font-display text-2xl font-black">
                {failed ? "Hit a snag" : "It's cooking 🔥"}
              </DialogTitle>
              <DialogDescription className="text-sm text-foreground/85">
                {failed ? (
                  <>
                    OG Bot is retrying <span className="font-bold text-foreground">{title}</span>{" "}
                    automatically. Keep this page handy and check back in a few minutes.
                  </>
                ) : (
                  <>
                    <span className="font-bold text-foreground">{title}</span> is in the booth.
                    Usually about 5 minutes. You can close this; come back to this page and it'll be
                    waiting.
                  </>
                )}
              </DialogDescription>
              <div aria-hidden className="mx-auto flex h-8 items-end justify-center gap-[3px]">
                {Array.from({ length: 11 }).map((_, i) => (
                  <span
                    key={i}
                    className="studio-vu-bar w-[3px] rounded-full bg-gradient-to-t from-destructive/50 to-destructive"
                    style={{
                      height: `${35 + ((i * 41) % 65)}%`,
                      animationDelay: `${(i * 0.11).toFixed(2)}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <StripeCheckoutDialog clientSecret={clientSecret} onClose={() => setClientSecret(null)} />
    </>
  );
}

export async function startGuestTrackSafely(track: Pick<GuestActiveTrack, "songId" | "plan">) {
  // The ledger row can land a moment after Stripe says "paid": retry briefly.
  for (let i = 0; i < 5; i++) {
    const call = startGuestTrack({ data: { songId: track.songId, plan: track.plan } });
    // Don't wait for the whole cook: only for the paid check.
    const first = await Promise.race([
      call,
      new Promise<{ ok: true; already: false }>((r) =>
        setTimeout(() => r({ ok: true, already: false }), 8000),
      ),
    ]).catch(() => null);
    if (first && first.ok) return true;
    if (first && "reason" in first && first.reason !== "unpaid") return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Full master player for the guest, with a tap-to-play fallback. */
function GuestTrackPlayer({ song, title }: { song: GuestSong; title: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPreview, setIsPreview] = useState(false);
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const fullReady = !!song.audio_path;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Full master when it's landed; the sample plays meanwhile.
      const mode = fullReady ? "full" : "preview";
      const { data, error } = await supabase.functions.invoke("song-url", {
        body: { song_id: song.id, mode },
      });
      if (cancelled) return;
      setIsPreview(mode === "preview");
      const el = audioRef.current;
      if (!error && data?.url && el) {
        el.src = data.url as string;
        el.load();
        try {
          claimAudio(el);
          await el.play();
        } catch {
          /* autoplay blocked: the play button does it */
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [song.id, fullReady]);

  async function toggle() {
    const el = audioRef.current;
    if (!el?.src) return;
    if (playing) el.pause();
    else {
      claimAudio(el);
      await el.play().catch(() => toast.error("Tap play again to start the track"));
    }
  }

  async function fetchMaster() {
    const { data, error } = await supabase.functions.invoke("song-url", {
      body: { song_id: song.id, mode: "full", purpose: "download", filename: `${title}.mp3` },
    });
    if (error || !data?.url) throw new Error("Couldn't prepare the MP3. Try again in a moment.");
    return downloadFile(data.url as string, `${title}.mp3`);
  }

  async function download() {
    setBusy("download");
    try {
      await fetchMaster();
      toast.success("Downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setBusy("share");
    try {
      const blob = await fetchMaster().catch(() => null);
      await shareTrack({ title, blob, filename: `${title}.mp3`, songId: song.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Share failed");
    } finally {
      setBusy(null);
    }
  }

  const pct =
    Number.isFinite(duration) && duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const fmt = (s: number) =>
    Number.isFinite(s) && s >= 0
      ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
      : "--:--";

  return (
    <section aria-label="Your finished track" className="space-y-4">
      <p className="text-center text-xs font-black uppercase tracking-[0.25em] text-amber-300">
        Track completed
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          className={`relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-destructive/40 bg-destructive/15 text-foreground ${
            !loading && !playing
              ? "shadow-glow-danger ring-2 ring-destructive motion-safe:animate-pulse"
              : ""
          }`}
        >
          {song.cover_url ? (
            <img
              src={song.cover_url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <span className="relative grid h-11 w-11 place-items-center rounded-full bg-background/70">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : playing ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 translate-x-[1px]" />
            )}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-xl font-black">{title}</h3>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isPreview ? "Preview while the master finishes" : "Full master"}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-destructive" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {fmt(time)} / {fmt(duration)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!fullReady || busy !== null}
          onClick={() => void download()}
          className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-destructive px-2 text-xs font-black uppercase tracking-wide text-destructive-foreground disabled:opacity-60 sm:text-sm"
        >
          {busy === "download" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {fullReady ? "Download MP3" : "Finishing…"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void share()}
          className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-white/15 bg-white/5 px-2 text-xs font-black uppercase tracking-wide text-foreground disabled:opacity-60 sm:text-sm"
        >
          {busy === "share" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Share2 className="h-4 w-4" />
          )}
          Share track
        </button>
      </div>
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        className="hidden"
      />
    </section>
  );
}

function SaveToLibraryCard({ onSave }: { onSave: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-300/40 bg-amber-500/10 p-4 text-center">
      <p className="flex items-center justify-center gap-2 font-bold text-amber-200">
        <Save className="h-4 w-4" /> Want to keep this track forever?
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Save it to your permanent OG Bot library so you never lose it across devices.
      </p>
      <button
        type="button"
        onClick={onSave}
        className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-amber-400 px-4 text-xs font-black uppercase tracking-wide text-black transition hover:bg-amber-300"
      >
        Create free account &amp; save track
      </button>
      <p className="mt-2 text-xs text-muted-foreground">
        Already an OG?{" "}
        <button
          type="button"
          onClick={onSave}
          className="font-bold text-foreground underline underline-offset-4"
        >
          Sign in
        </button>
      </p>
    </div>
  );
}
