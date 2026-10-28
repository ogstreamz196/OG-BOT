import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sendTrackToMyTelegram } from "@/lib/telegram-track.functions";
import { cn } from "@/lib/utils";

const MESSAGES: Record<string, string> = {
  not_linked: "Link Telegram in Settings first",
  not_found: "That track isn't ready yet",
  locked: "Unlock the full track first",
  not_ready: "Track's still finishing, try again in a minute",
  too_soon: "Already sent, check your Telegram",
  failed: "Couldn't send it to Telegram, try again",
};

/** Whether the signed-in member has a Telegram chat linked (false if unknown). */
function useTelegramLinked(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["telegram-linked", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("telegram_chat_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) return false;
      return !!data?.telegram_chat_id;
    },
  });
  return data === true;
}

/**
 * Sends an unlocked track to the member's linked Telegram as an MP3 via OG B0T.
 * Hidden for members without Telegram linked. "icon" fits the library rows.
 */
export function SendToTelegramButton({
  songId,
  title,
  variant = "full",
  disabled,
  className,
}: {
  songId: string;
  title: string;
  variant?: "full" | "icon";
  disabled?: boolean;
  className?: string;
}) {
  const linked = useTelegramLinked();
  const send = useServerFn(sendTrackToMyTelegram);
  const [busy, setBusy] = useState(false);
  if (!linked) return null;

  async function go() {
    setBusy(true);
    try {
      const { result } = await send({ data: { songId } });
      if (result === "sent") toast.success("Sent to your Telegram 🎧");
      else toast.error(MESSAGES[result] ?? MESSAGES.failed);
    } catch {
      toast.error(MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  }

  const icon = busy ? (
    <Loader2 className={cn("animate-spin", variant === "icon" ? "h-3.5 w-3.5" : "h-4 w-4")} />
  ) : (
    <Send className={variant === "icon" ? "h-3.5 w-3.5" : "h-4 w-4"} />
  );

  if (variant === "icon")
    return (
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy || disabled}
        aria-label={`Send ${title} to Telegram`}
        title="Send to Telegram"
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-40",
          className,
        )}
      >
        {icon}
      </button>
    );

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void go()}
      disabled={busy || disabled}
      className={cn(
        "gap-2 border-emerald-400/40 bg-emerald-500/10 font-bold text-emerald-200",
        className,
      )}
    >
      {icon} Send to Telegram
    </Button>
  );
}
