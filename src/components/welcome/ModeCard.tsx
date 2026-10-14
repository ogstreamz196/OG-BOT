import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "blue" | "crimson";

const TONES: Record<Tone, { ring: string; eyebrow: string; cta: string; glow: string }> = {
  blue: {
    ring: "hover:border-primary/70 focus-within:ring-primary motion-safe:hover:shadow-lift-primary",
    eyebrow: "text-primary",
    cta: "bg-primary text-primary-foreground shadow-glow",
    glow: "from-primary/35",
  },
  crimson: {
    ring: "hover:border-destructive/70 focus-within:ring-destructive motion-safe:hover:shadow-lift-danger",
    eyebrow: "text-destructive",
    cta: "bg-destructive text-destructive-foreground shadow-glow-danger",
    glow: "from-destructive/35",
  },
};

/**
 * One of the two main modes on the landing page. Both cards share the same
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
  className,
  style,
}: {
  image: string;
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
  return (
    <article
      style={style}
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden lg:flex-row rounded-2xl border border-white/12 bg-card/90 text-left shadow-card backdrop-blur-xl transition duration-300 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-background motion-safe:hover:-translate-y-1 sm:rounded-3xl",
        t.ring,
        className,
      )}
    >
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-card lg:m-3 lg:w-40 lg:self-center lg:rounded-2xl">
        <img
          src={image}
          alt={imageAlt}
          width={960}
          height={960}
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.04]"
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t to-transparent opacity-80 lg:hidden",
            t.glow,
          )}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-5 lg:pl-1">
        <p
          className={cn(
            "text-[0.7rem] font-black uppercase tracking-[0.18em] sm:text-xs sm:tracking-[0.22em]",
            t.eyebrow,
          )}
        >
          {eyebrow}
        </p>
        <h3 className="font-display text-xl font-black uppercase leading-none tracking-tight sm:text-2xl">
          {title}
        </h3>
        <p className="mb-1 line-clamp-3 text-xs leading-snug sm:mb-2 text-foreground/85 sm:line-clamp-none sm:text-sm sm:leading-relaxed">
          {description}
        </p>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "mt-auto inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-1.5 pt-0.5 text-center text-[0.72rem] leading-tight font-black uppercase tracking-normal sm:px-3 sm:tracking-wide transition after:absolute after:inset-0 after:z-10 after:content-[''] active:transform-none focus-visible:outline-none group-hover:ring-2 group-hover:ring-white/25 sm:text-sm",
            t.cta,
          )}
        >
          <span>{cta}</span>
          <ArrowRight
            aria-hidden
            className="hidden h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 min-[400px]:inline"
          />
        </button>
      </div>
    </article>
  );
}
