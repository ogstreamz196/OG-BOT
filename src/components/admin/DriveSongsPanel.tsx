import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { backfillDriveArchive, getDriveSongStatus } from "@/lib/drive-archive.functions";
import { AdminSection } from "./AdminSection";

const KEY = ["drive-song-status"];

/**
 * Boss: songs live on the Boss's Google Drive. Shows how many finished songs
 * are there, and moves the rest a few at a time (new ones go there by
 * themselves within about five minutes of finishing).
 */
export function DriveSongsPanel() {
  const qc = useQueryClient();
  const load = useServerFn(getDriveSongStatus);
  const move = useServerFn(backfillDriveArchive);
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => load() });
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const stop = useRef(false);

  async function moveAll() {
    setRunning(true);
    stop.current = false;
    setFailures([]);
    let moved = 0;
    let failed = 0;
    try {
      // A few at a time until nothing is left (or only songs that keep failing).
      for (let round = 0; round < 100 && !stop.current; round++) {
        const out = await move({ data: { limit: 5 } });
        moved += out.archived;
        failed += out.failures.length;
        if (out.failures.length) setFailures((f) => [...f, ...out.failures].slice(-10));
        setNote(`Moved ${moved} so far${failed ? `, ${failed} couldn't be moved` : ""}…`);
        await qc.invalidateQueries({ queryKey: KEY });
        if (out.considered === 0 || out.archived === 0) break;
      }
      setNote(`Done: ${moved} moved${failed ? `, ${failed} couldn't be moved (see below)` : ""}.`);
    } catch (e) {
      setNote(`Stopped: ${e instanceof Error ? e.message : "something went wrong"}`);
    } finally {
      setRunning(false);
      await qc.invalidateQueries({ queryKey: KEY });
    }
  }

  const left = data ? data.total - data.onDrive : 0;

  return (
    <AdminSection
      icon={<HardDrive className="h-4 w-4 text-emerald-400" />}
      title="Songs on your Google Drive"
      subtitle="Full songs are kept on your Drive and played from there (previews stay on the site). New songs go there by themselves within about five minutes."
    >
      {isLoading || !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-4 text-sm">
          {!data.driveConnected && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
              Google Drive isn't connected, so songs can't be moved yet.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl border border-emerald-500/40 p-3">
              <div className="text-xs text-muted-foreground">On your Drive</div>
              <div className="text-lg font-black text-emerald-400">{data.onDrive}</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="text-xs text-muted-foreground">Still to move</div>
              <div className="text-lg font-black text-foreground">{left}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={running || left === 0 || !data.driveConnected}
              onClick={() => void moveAll()}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move all songs to Drive"}
            </Button>
            {running && (
              <Button variant="outline" onClick={() => (stop.current = true)}>
                Stop
              </Button>
            )}
          </div>
          {note && <p className="text-muted-foreground">{note}</p>}
          {failures.length > 0 && (
            <ul className="space-y-1 text-xs text-rose-300">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AdminSection>
  );
}
