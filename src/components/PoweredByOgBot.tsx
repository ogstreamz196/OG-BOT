import ogBotLogo from "@/assets/ogbot.png.asset.json";
import { cn } from "@/lib/utils";

interface PoweredByOgBotProps {
  variant?: "footer" | "inline";
  className?: string;
}

/**
 * Persistent "Powered by OG Bot" badge. Used in headers and footers across
 * the landing page, MusicHUB and Messenger so OG Bot branding is always visible.
 */
export function PoweredByOgBot({ variant = "footer", className }: PoweredByOgBotProps) {
  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-foreground/80 backdrop-blur-md",
          className,
        )}
        aria-label="Powered by OG Bot"
      >
        <img
          src={ogBotLogo.url}
          alt=""
          aria-hidden="true"
          className="h-4 w-4 rounded-full object-cover ring-1 ring-primary/50"
        />
        Powered by OG Bot
      </span>
    );
  }
  return (
    <footer
      className={cn(
        "mt-8 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-card/40 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground backdrop-blur-md",
        className,
      )}
      aria-label="Powered by OG Bot"
    >
      <img
        src={ogBotLogo.url}
        alt=""
        aria-hidden="true"
        className="h-6 w-6 rounded-full object-cover ring-1 ring-primary/50"
      />
      <span>Powered by</span>
      <span className="text-foreground">OG Bot</span>
    </footer>
  );
}
