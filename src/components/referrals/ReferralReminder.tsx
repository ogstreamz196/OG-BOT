import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Share2, Sparkles, Copy, Check } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Compact, share-first reminder: shows the user's OG referral code and the
 * 6%–13% commission promise. Drop it anywhere coins are being spent or bought
 * so the cashback loop stays top-of-mind.
 */
export function ReferralReminder({ className }: { className?: string }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const { data: code } = useQuery({
    queryKey: ["my-referral-code", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user!.id)
        .maybeSingle();
      return (data?.referral_code as string | null) ?? null;
    },
  });

  if (!code) return null;

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/r/${code.replace(/^OG-/, "")}`
      : `/r/${code.replace(/^OG-/, "")}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied — share it to earn up to 13% cashback");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && (navigator as Navigator).share) {
      try {
        await (navigator as Navigator).share({
          title: "Join me on OG",
          text: `Use my OG code ${code} — we both win.`,
          url: shareUrl,
        });
        return;
      } catch {
        /* fall through */
      }
    }
    copy();
  }

  return (
    <div
      data-testid="referral-reminder"
      className={cn(
        // Consistent responsive padding via clamp keeps spacing identical
        // looking across phone → tablet → desktop.
        "relative overflow-hidden rounded-lg border border-border bg-background/50 [padding:clamp(0.75rem,2.5vw,1rem)]",
        className,
      )}
    >
      {/* Mobile: stacked. sm+: row with auto-sized action cluster.
          grid-cols-[minmax(0,1fr)_auto] guarantees the text column can shrink
          and the buttons never get clipped. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase text-foreground/85">
              Earn up to 13% cashback
            </div>
            <p
              className="text-foreground [overflow-wrap:anywhere]"
              style={{ fontSize: "clamp(0.8125rem, 2.6vw, 0.9375rem)", lineHeight: 1.35 }}
            >
              Share your code and bank 6% of every coin they burn — 13% as an OG VIP. Forever.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
              <code
                aria-label={`Your referral code ${code}`}
                className="max-w-full truncate rounded-md bg-background/60 px-2 py-1 font-mono text-xs font-bold tracking-wider text-foreground ring-1 ring-coin/30"
              >
                {code}
              </code>
              <Button
                type="button"
                onClick={copy}
                aria-label={copied ? "Referral link copied" : "Copy referral link"}
                aria-live="polite"
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 px-2 text-xs text-foreground/85 focus-visible:ring-2 sm:min-h-9"
              >
                {copied ? (
                  <Check className="h-4 w-4 sm:h-3 sm:w-3" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4 sm:h-3 sm:w-3" aria-hidden />
                )}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </div>
        </div>
        {/* Action cluster: full width on mobile so buttons are tappable;
            auto width on sm+ so it never crowds the text. */}
        <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
          <Button
            type="button"
            onClick={share}
            aria-label="Share your referral link"
            size="sm"
            className="h-11 flex-1 font-bold focus-visible:ring-2 sm:h-9 sm:flex-none"
          >
            <Share2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden /> Share
          </Button>
          <Link
            to="/referrals"
            aria-label="See referral earnings details"
            className="inline-flex h-11 min-w-20 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-accent focus-visible:ring-2 sm:h-9"
          >
            Details →
          </Link>
        </div>
      </div>
    </div>
  );
}
