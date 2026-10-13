import { Coins } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Coin-themed pill — `<CoinPill>{n} per send</CoinPill>` etc. Centralizes the
 * "border-coin/30 bg-coin/10 text-coin" treatment so cost callouts stay
 * visually consistent across the workspace, store, and messenger.
 */
export function CoinPill({
  children,
  icon = <Coins className="h-3.5 w-3.5" />,
  className,
  size = "md",
}: {
  children: ReactNode;
  icon?: ReactNode | false;
  className?: string;
  size?: "sm" | "md";
}) {
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-coin/30 bg-coin/10 font-semibold text-coin",
        padding,
        className,
      )}
    >
      {icon || null}
      {children}
    </span>
  );
}
