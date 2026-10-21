import type { ModeArt } from "@/assets/mode-art";
import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "blue" | "crimson" | "silver" | "gold";

const TONES: Record<Tone, { ring: string; eyebrow: string; cta: string; glow: string }> = {
  blue: {
    ring: "hover:border-primary/70 focus-within:ring-primary motion-safe:hover:shadow-lift-primary",
    eyebrow: "text-muted-foreground",
    cta: "bg-primary text-primary-foreground shadow-glow",
    glow: "from-primary/35",
  },
  crimson: {
    ring: "hover:border-destructive/70 focus-within:ring-destructive motion-safe:hover:shadow-lift-danger",
    eyebrow: "text-destructive",
    cta: "bg-destructive text-destructive-foreground shadow-glow-danger",
    glow: "from-destructive/35",
  },
  silver: {
    ring: "hover:border-accent/70 focus-within:ring-accent",
    eyebrow: "text-foreground/80",
    cta: "bg-accent text-accent-foreground",
    glow: "from-accent/30",
  },
  gold: {
    ring: "hover:border-amber-300/70 focus-within:ring-amber-300",
    eyebrow: "text-amber-300",
    cta: "bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500 text-black shadow-[0_0_16px_rgba(251,191,36,0.45)]",
    glow: "from-amber-500/30",
  },
};

/**
 * One of the modes on the landing page and members' home (Battle Zone, Music
 * Hub, Sports Guide, OG Carrom). Both cards share the same
 * square artwork, spacing and button placement; the button's stretched hit
 * area makes the whole card one tap target.
 */
export function ModeCard({
  image,
  imageAlt,
  eyebrow,
  title,
  description,
  cta,
  onClick,
  tone = "blue",
  live = false,
  className,
  style,
  compact = false,
  badge,
  onShown,
}: {
  /** Called with the card's element once it's on the page; return a clean-up. */
  onShown?: (el: HTMLElement) => () => void;
  /** Shorter artwork and tighter text, for the members' first screen. */
  compact?: boolean;
  /** Small chip over the artwork, e.g. "Free entry". */
  badge?: string;
  /** Show a pulsing "live" dot before the eyebrow. */
  live?: boolean;
  image: string | ModeArt;
  imageAlt: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  tone?: Tone;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = TONES[tone];
  const ref = useRef<HTMLElement>(null);
  useEffect(() => (onShown && ref.current ? onShown(ref.current) : undefined), [onShown]);
  return (
    <article
      ref={ref}
      style={style}
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden lg:flex-row rounded-2xl border border-white/12 bg-card/90 text-left shadow-card backdrop-blur-xl transition duration-300 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-background motion-safe:hover:-translate-y-1 sm:rounded-3xl",
        t.ring,
        className,
      )}
    >
      <div
        className={cn(
          "relative w-full shrink-0 overflow-hidden bg-card lg:m-3 lg:w-40 lg:self-center lg:rounded-2xl",
          compact ? "aspect-[16/11] lg:aspect-square" : "aspect-square",
        )}
      >
        {badge ? (
          <span className="absolute left-2 top-2 z-[1] rounded-full border border-white/20 bg-background/75 px-2 py-0.5 text-[0.6rem] font-black uppercase tracking-wider text-foreground backdrop-blur-md">
            {badge}
          </span>
        ) : null}
        <img
          src={typeof image === "string" ? image : image.src}
          srcSet={typeof image === "string" ? undefined : image.srcSet}
          // Two columns on phones, a fixed 160px tile on large screens.
          sizes="(min-width: 1024px) 160px, (min-width: 640px) 33vw, 50vw"
          alt={imageAlt}
          width={960}
          height={960}
          decoding="async"
          className={cn(
            "h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.04]",
            compact && "object-[center_62%] lg:object-center",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t to-transparent opacity-80 lg:hidden",
            t.glow,
          )}
        />
      </div>
      <div
        className={cn("flex min-w-0 flex-1 flex-col sm:p-5 lg:pl-1", compact ? "p-2.5" : "p-3.5")}
      >
        <p
          className={cn(
            "flex items-center gap-1.5 text-[0.68rem] font-black uppercase tracking-[0.16em] sm:text-xs sm:tracking-[0.2em]",
            t.eyebrow,
          )}
        >
          {live ? (
            <span aria-hidden className="relative inline-flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inset-0 rounded-full bg-destructive motion-safe:animate-ping" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-destructive" />
            </span>
          ) : null}
          {eyebrow}
        </p>
        <h3
          className={cn(
            "font-display font-black uppercase leading-none tracking-tight sm:mt-1.5 sm:text-2xl",
            compact ? "mt-1 text-[1.15rem]" : "mt-1.5 text-[1.35rem]",
          )}
        >
          {title}
        </h3>
        <p
          className={cn(
            "leading-snug text-foreground/85 sm:mt-1.5 sm:mb-3.5 sm:text-sm sm:leading-relaxed",
            compact ? "mt-1 mb-2.5 line-clamp-2 text-[0.74rem]" : "mt-1.5 mb-3.5 text-[0.8rem]",
          )}
        >
          {description}
        </p>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            compact ? "min-h-10" : "min-h-11",
            "mt-auto inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-1 pt-0.5 text-center text-[0.7rem] leading-none font-black uppercase tracking-normal sm:px-3 sm:tracking-wide transition after:absolute after:inset-0 after:z-10 after:content-[''] active:transform-none focus-visible:outline-none group-hover:ring-2 group-hover:ring-white/25 sm:text-sm",
            t.cta,
          )}
        >
          <span>{cta}</span>
          <ArrowRight
            aria-hidden
            className="hidden h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 sm:inline"
          />
        </button>
      </div>
    </article>
  );
}
