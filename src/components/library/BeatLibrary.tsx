import { useEffect, useRef, useState } from "react";
import { Disc3, Loader2, Pause, Pencil, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

export type SavedBeat = { path: string; name: string; size: number };

const MAX_BYTES = 20 * 1024 * 1024;

function pretty(name: string) {
  // Uploads are stored as `<timestamp>-<original name>`; show the readable part.
  const stripped = name.replace(/^\d{10,}-/, "");
  const base = stripped.replace(/\.[a-z0-9]+$/i, "") || stripped;
  // Wizard uploads land as bare UUIDs — give those a friendly short label.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) {
    return `Beat ${base.slice(0, 8).toUpperCase()}`;
  }
  return base;
}

function prettySize(bytes: number) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Keep the stored `<timestamp>-` prefix and file extension, swap the label. */
function renamedPath(path: string, label: string) {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const file = path.slice(slash + 1);
  const prefix = /^(\d{10,})-/.exec(file)?.[1] ?? String(Date.now());
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1] ?? "mp3";
  const safe = label
    .trim()
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${dir}/${prefix}-${safe || "beat"}.${ext}`;
}

/**
 * Beat library — the user's own uploaded instrumentals, saved in the private
 * `beats` bucket. Every row shows its live status, what a remix costs, and
 * clear rename / delete controls. "New vocals" opens the create wizard
 * pre-armed with vocals-only mode over that beat.
 */
export function BeatLibrary({
  userId,
  onRemix,
}: {
  userId: string | undefined;
  onRemix: (beat: SavedBeat) => void;
}) {
  const [beats, setBeats] = useState<SavedBeat[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedBeat | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SavedBeat | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { data: settings } = useSettings();
  const remixCost = settings?.coins_per_generation ?? 3;

  async function load() {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("beats")
        .list(userId, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      if (error) throw error;
      setBeats(
        (data ?? [])
          .filter((f) => !f.name.startsWith("."))
          .map((f) => ({
            path: `${userId}/${f.name}`,
            name: pretty(f.name),
            size: (f.metadata as { size?: number } | null)?.size ?? 0,
          })),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load your beats");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  async function upload(file: File) {
    if (!userId) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Please choose an audio file (MP3, WAV, M4A…)");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Beat must be under 20MB");
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-60);
      const path = `${userId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage
        .from("beats")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      toast.success("Beat saved to your library");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function togglePlay(beat: SavedBeat) {
    const el = (audioRef.current ??= new Audio());
    if (playing === beat.path) {
      el.pause();
      setPlaying(null);
      return;
    }
    setBusyPath(beat.path);
    try {
      const { data, error } = await supabase.storage.from("beats").createSignedUrl(beat.path, 600);
      if (error || !data?.signedUrl) throw error ?? new Error("Couldn't open that beat");
      el.src = data.signedUrl;
      el.onended = () => setPlaying(null);
      await el.play();
      setPlaying(beat.path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Playback failed");
    } finally {
      setBusyPath(null);
    }
  }

  async function saveRename() {
    const beat = renaming;
    const label = renameValue.trim();
    if (!beat) return;
    if (label.length < 2) {
      toast.error("Give the beat a name of at least 2 characters");
      return;
    }
    const target = renamedPath(beat.path, label);
    if (target === beat.path) {
      setRenaming(null);
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase.storage.from("beats").move(beat.path, target);
      if (error) throw error;
      if (playing === beat.path) {
        audioRef.current?.pause();
        setPlaying(null);
      }
      setBeats((list) =>
        list.map((b) =>
          b.path === beat.path
            ? { ...b, path: target, name: pretty(target.split("/").pop() ?? label) }
            : b,
        ),
      );
      toast.success("Beat renamed");
      setRenaming(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setSavingName(false);
    }
  }

  async function remove(beat: SavedBeat) {
    setBusyPath(beat.path);
    try {
      const { error } = await supabase.storage.from("beats").remove([beat.path]);
      if (error) throw error;
      if (playing === beat.path) {
        audioRef.current?.pause();
        setPlaying(null);
      }
      setBeats((b) => b.filter((x) => x.path !== beat.path));
      toast.success("Beat deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyPath(null);
    }
  }

  const isEmpty = !loading && beats.length === 0;

  return (
    <section className={cn("studio-panel px-4 sm:px-5", isEmpty ? "py-3" : "py-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Disc3 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2
              className={cn(
                "whitespace-nowrap font-display font-black tracking-tight",
                isEmpty ? "text-base" : "text-xl sm:text-2xl",
              )}
            >
              Beat library
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {isEmpty ? "Got your own beat? Add it and sing over it." : "Save beats · remix anytime"}
            </p>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={uploading || !userId}
          onClick={() => fileRef.current?.click()}
          className="shrink-0 gap-1 px-2.5 text-xs font-black uppercase tracking-wide"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>

      <div className={cn(isEmpty ? "hidden" : "mt-4")}>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading your beats…</p>
        ) : beats.length === 0 ? null : (

          <ul className="grid w-full gap-1.5">
            {beats.map((b) => {
              const busy = busyPath === b.path;
              const isPlaying = playing === b.path;
              const status = busy ? "Working" : isPlaying ? "Playing" : "Ready";
              const size = prettySize(b.size);
              return (
                <li
                  key={b.path}
                  className={cn(
                    "w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-background/40 px-3 py-2.5",
                    isPlaying && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={isPlaying ? `Pause ${b.name}` : `Play ${b.name}`}
                      disabled={busy}
                      onClick={() => void togglePlay(b)}
                      className="h-9 w-9 shrink-0 rounded-full border border-primary/30 text-primary"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>

                    <p className="min-w-0 flex-1 truncate text-sm font-bold" title={b.name}>
                      {b.name}
                    </p>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onRemix(b)}
                      aria-label={`New vocals over ${b.name} for ${remixCost} coins`}
                      className="h-8 shrink-0 gap-1.5 bg-gradient-brand px-2.5 text-[11px] font-black uppercase tracking-wide text-primary-foreground sm:px-3"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">New vocals</span>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Rename ${b.name}`}
                      disabled={busy}
                      onClick={() => {
                        setRenaming(b);
                        setRenameValue(b.name);
                      }}
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${b.name}`}
                      disabled={busy}
                      onClick={() => setConfirmDelete(b)}
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-11 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-px font-black",
                        isPlaying
                          ? "border-primary/50 text-primary"
                          : busy
                            ? "border-white/20 text-muted-foreground"
                            : "border-emerald-400/40 text-emerald-300",
                      )}
                    >
                      {status}
                    </span>
                    <span className="rounded-full border border-amber-400/40 px-1.5 py-px font-black text-amber-300">
                      {remixCost} coins to remix
                    </span>
                    {size ? <span>{size}</span> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename beat</DialogTitle>
            <DialogDescription>Pick a name you'll recognise in your library.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            autoFocus
            maxLength={60}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveRename();
            }}
            aria-label="Beat name"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={savingName} onClick={() => void saveRename()}>
              {savingName ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this beat?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name} will be removed from your library. Tracks you already made with
              it stay safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const beat = confirmDelete;
                setConfirmDelete(null);
                if (beat) void remove(beat);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
