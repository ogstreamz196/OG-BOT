import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { Crown } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { CURRENCY_SYMBOL, VIP_PLAN, VIP_PLAN_YEARLY } from "@/lib/coin-packs";

const PERKS = [
  "🤬 Foul Mouth 0G B0T",
  "⚡ Priority AI",
  "🎛️ Every music style",
  "👑 Gold badge + OG VIP ID",
  "💸 13% referral cashback",
  "🪙 10 free coins a day",
] as const;

const YEAR = VIP_PLAN_YEARLY.priceCents / 100;
const PER_MONTH = (VIP_PLAN_YEARLY.priceCents / 1200).toFixed(2);
const SAVE = Math.round((1 - VIP_PLAN_YEARLY.priceCents / (VIP_PLAN.priceCents * 12)) * 100);

/**
 * Members' home: a calm pitch for OG VIP Yearly. Hidden for paying VIPs.
 * Trial members see how long their free VIP has left. On the phone apps the
 * Store shows the Google Play / Apple plans at the top, so no jump link there.
 */
export function VipYearlyTeaser() {
  const { hasVipRole, isTrial, trialEndsAt, isLoading } = useRole();
  const [native, setNative] = useState(false);
  useEffect(() => setNative(Capacitor.isNativePlatform()), []);

  if (hasVipRole || isLoading) return null;

  const daysLeft =
    isTrial && trialEndsAt
      ? Math.max(1, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
      : null;

  return (
    <section
      aria-labelledby="vip-yearly-title"
      className="og-vip-teaser relative overflow-hidden rounded-3xl border bg-card/90 p-5 backdrop-blur-xl sm:p-8"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 og-vip-teaser__glow rounded-full blur-3xl"
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.25em] og-vip-teaser__eyebrow sm:text-sm">
            <Crown className="h-4 w-4 fill-current" /> OG VIP Yearly
          </p>
          <h2
            id="vip-yearly-title"
            className="font-display mt-2 text-balance text-3xl font-black leading-[0.95] tracking-tight sm:text-4xl"
          >
            {daysLeft
              ? `Your free VIP ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`
              : "Let 0G B0T off the leash"}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-foreground/85 sm:text-base">
            {daysLeft
              ? "Keep everything you've been using. Lock in a whole year and forget about it."
              : "Unfiltered roasts, faster replies and every style in the studio. One payment covers the year."}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {PERKS.map((p) => (
              <li
                key={p}
                className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-xs font-semibold text-foreground/90 sm:text-sm"
              >
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 text-center sm:w-56">
          <p className="font-display text-4xl font-black leading-none">
            {CURRENCY_SYMBOL}
            {YEAR}
            <span className="ml-1 text-base font-bold text-foreground/70">/year</span>
          </p>
          <p className="text-xs font-semibold text-foreground/75">
            About {CURRENCY_SYMBOL}
            {PER_MONTH} a month · save {SAVE}%
          </p>
          <Link
            to="/store"
            hash={native ? undefined : "section-vip"}
            className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 og-vip-teaser__btn rounded-xl px-5 text-sm font-black uppercase tracking-wide transition focus-visible:outline-none"
          >
            <Crown className="h-4 w-4" /> Go VIP Yearly
          </Link>
          <p className="text-[0.7rem] text-foreground/65">
            Or {CURRENCY_SYMBOL}
            {(VIP_PLAN.priceCents / 100).toFixed(2)} monthly. Cancel any time.
          </p>
        </div>
      </div>
    </section>
  );
}
