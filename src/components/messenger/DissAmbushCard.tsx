import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Flame, Coins, CreditCard, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { chargeDissTrack, refundDissTrack } from "@/lib/diss-track.functions";
import { DISS_STYLES, DISS_TRACK_COST, DISS_TRACK_PRICE_GBP, collectAmmo } from "@/lib/diss-ambush";
import type { OgChatMessage } from "@/lib/og-messenger.functions";

export function DissAmbushCard({
  balance,
  history,
  userId,
  displayName,
  onResolve,
}: {
  balance: number;
  history: OgChatMessage[];
  userId: string;
  displayName: string | null;
  /** Called once the user picks: closes the card and adds a bot line. */
  onResolve: (botLine: string) => void;
}) {
  const [style, setStyle] = useState<string>(DISS_STYLES[0]);
  const [busy, setBusy] = useState(false);
  const charge = useServerFn(chargeDissTrack);
  const refund = useServerFn(refundDissTrack);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canAfford = balance >= DISS_TRACK_COST;

  async function cook() {
    if (busy) return;
    setBusy(true);
    const attemptId = crypto.randomUUID();
    let charged = false;
    try {
      await charge({ data: { attemptId } });
      charged = true;
      qc.invalidateQueries({ queryKey: ["profile"] });
      const ammo = collectAmmo(history);
      const name = displayName?.trim() || "this clown";
      const title = `Diss on ${name}`.slice(0, 80);
      const { data: lyr, error: lyrErr } = await supabase.functions.invoke("generate-lyrics", {
        body: {
          songName: title,
          description: `A savage, funny ${style} diss track roasting ${name}, built from what they told OG Bot in chat.`,
          styleTags: [style, "diss track"],
          language: "English",
          vocal: "Male voice",
          targetDurationSec: 120,
          foulMouth: true,
          foulIntensity: 3,
          mode: "og",
          personalDetails: ammo.slice(0, 500),
          subjectName: name.slice(0, 60),
        },
      });
      const lyrics = (lyr?.lyrics ?? "").toString();
      if (lyrErr || !lyrics) throw new Error("OG Bot choked on the bars — coins returned, try again.");
      const { data: row, error: insErr } = await supabase
        .from("songs")
        .insert({
          user_id: userId,
          title,
          prompt: `${title} — Style: ${style}\n— Idea: ${ammo.slice(0, 400)}`,
          style: `${style}, diss track`,
          lyrics,
          status: "draft",
          foul_mouth: true,
          foul_intensity: 3,
        } as never)
        .select("id")
        .single();
      if (insErr || !row?.id) throw new Error("Couldn't save the track — coins returned.");
      const { data: gen, error: genErr } = await supabase.functions.invoke("suno-generate", {
        body: { song_id: row.id, prompt: title, lyrics, title, style: `${style}, diss track`, language: "English", vocal: "Male voice", target_duration_sec: 120 },
      });
      if (genErr || gen?.accepted === false) throw new Error("Studio's busy — coins returned, try again soon.");
      charged = false; // track started; charge stands
      onResolve(`🔥 Cooking your ${style} diss track now. Brace yourself.`);
      toast.success("Your diss track is cooking");
      navigate({ to: "/library/$songId", params: { songId: row.id } });
    } catch (e) {
      if (charged) await refund({ data: { attemptId } }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.error(e instanceof Error ? e.message : "Something broke — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="diss-ambush-card"
      className="mt-2 w-full max-w-sm rounded-2xl border-2 border-destructive/60 bg-destructive/10 p-3 shadow-lg"
    >
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-destructive">
        <Flame className="h-4 w-4" /> OG Bot diss ambush
      </div>
      <p className="mt-1 text-xs text-foreground/80">
        A diss track made from what you told me. Balance:{" "}
        <span className="font-bold text-coin">{balance} coins</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Diss style">
        {DISS_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={style === s}
            onClick={() => setStyle(s)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-bold",
              style === s ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background/60",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-1.5">
        {canAfford ? (
          <Button onClick={cook} disabled={busy} variant="destructive" className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
            Cook it — {DISS_TRACK_COST} coins
          </Button>
        ) : (
          <Button onClick={() => navigate({ to: "/buy-coins" })} variant="destructive" className="w-full">
            <CreditCard className="h-4 w-4" /> Get {DISS_TRACK_COST} coins — {DISS_TRACK_PRICE_GBP}
          </Button>
        )}
        {canAfford && (
          <Button onClick={() => navigate({ to: "/buy-coins" })} variant="outline" className="w-full" disabled={busy}>
            <CreditCard className="h-4 w-4" /> Top up — {DISS_TRACK_PRICE_GBP} for {DISS_TRACK_COST} coins
          </Button>
        )}
        <Button
          variant="ghost"
          className="w-full"
          disabled={busy}
          onClick={() => onResolve("Bottled it? Fine — keep talking, I'm saving all this ammo for later. 😈")}
        >
          <MessageCircle className="h-4 w-4" /> Keep chatting for now
        </Button>
      </div>
    </div>
  );
}
