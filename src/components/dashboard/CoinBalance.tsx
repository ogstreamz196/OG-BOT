import { Coins, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";

/**
 * Header Coin Balance pill — prominent, tappable, realtime.
 * - Subscribes via `useProfile` which listens to Supabase Realtime
 *   so the balance updates instantly after Stripe checkout and after
 *   generation jobs settle.
 * - Mobile: shows just the icon + number with a "+" affordance, links
 *   straight to /buy-coins (44px tap target).
 * - sm+: shows the "OG coins" label too.
 */
export function CoinBalance({ className }: { className?: string }) {
  const { data, isLoading } = useProfile();
  const raw = data?.coin_balance ?? 0;

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading coin balance"
        aria-busy="true"
        data-coin-balance-pill
        tabIndex={-1}
        className={cn(
          "inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border-2 border-coin/25 bg-coin/5 px-2 py-1 backdrop-blur-md sm:gap-2 sm:px-3.5 sm:py-1.5",
          className,
        )}
      >
        <span className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-coin/30 sm:h-[1.05rem] sm:w-[1.05rem]" />
        <span className="h-3.5 w-10 animate-pulse rounded bg-coin/25 sm:h-4 sm:w-14" />
        <span className="hidden h-3 w-14 animate-pulse rounded bg-coin/20 sm:inline-block" />
        <span className="ml-0.5 h-5 w-5 shrink-0 animate-pulse rounded-full bg-coin/25 sm:h-[1.25rem] sm:w-[1.25rem]" />
        <span className="sr-only">Loading coin balance…</span>
      </div>
    );
  }

  const balance = raw;
  const compact = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(raw);
  const full = new Intl.NumberFormat("en").format(raw);

  return (
    <Link
      to="/buy-coins"
      preload="intent"
      data-coin-balance-pill
      aria-label={`OG coin balance: ${balance}. Tap to buy more.`}
      title={`OG coin balance: ${full} — tap to buy more`}
      className={cn(
        "group inline-flex min-h-[36px] max-w-full shrink-0 items-center gap-1.5 rounded-full border-2 border-coin/40 bg-gradient-to-r from-coin/15 via-amber-500/10 to-coin/15 px-2 py-1 shadow-[0_0_18px_-4px_rgba(245,158,11,0.45)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-coin/70 hover:shadow-[0_0_24px_-2px_rgba(245,158,11,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-coin/60 sm:gap-2 sm:px-3.5 sm:py-1.5",
        className,
      )}
    >
      <Coins
        aria-hidden
        className="h-4 w-4 shrink-0 text-coin transition-transform group-hover:scale-110 sm:h-[1.05rem] sm:w-[1.05rem]"
      />

      <span
        data-testid="coin-balance"
        aria-live="polite"
        className="font-display text-sm font-black leading-none tabular-nums text-coin drop-shadow-[0_0_8px_rgba(245,158,11,0.45)] sm:text-base"
      >
        {/* Compact on mobile, full number from sm+ */}
        <span className="sm:hidden">{compact}</span>
        <span className="hidden sm:inline">{full}</span>
      </span>
      <span className="hidden text-[10px] font-bold uppercase tracking-[0.14em] text-coin/80 sm:inline">
        OG&nbsp;coins
      </span>
      <span
        aria-hidden
        className="ml-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-full bg-coin/20 text-coin transition-colors group-hover:bg-coin/40 sm:h-[1.25rem] sm:w-[1.25rem]"
      >
        <Plus className="h-3 w-3" strokeWidth={3} />
      </span>
    </Link>
  );
}
