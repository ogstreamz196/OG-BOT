import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The big image tiles from the signed-in home page. Shared with the
 * landing page so both look exactly the same; there the tiles open the
 * create wizard / guest Battle Zone popup via `onClick` instead of a page.
 */
export function PrimaryCard({
  to,
  search,
  onClick,
  image,
  imageAlt,
  eyebrow,
  title,
  body,
  cta,
  variant = "primary",
  wide = false,
  hazard = false,
}: {
  /** Page to open. Omit and pass `onClick` to open a popup instead (landing page). */
  to?: "/library" | "/messenger" | "/sports";
  search?: { live?: boolean };
  onClick?: () => void;
  image: string;
  imageAlt: string;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  variant?: "primary" | "accent" | "cinema";
  wide?: boolean;
  hazard?: boolean;
}) {
  const isAccent = variant === "accent";
  const isCinema = variant === "cinema";
  const className = cn(
    "group relative flex flex-row overflow-hidden rounded-3xl border-2 border-white/15 bg-card/85 shadow-card sm:flex-col backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-primary/60 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    wide && "sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]",
  );
  const content = (
    <>
      {/* Ambient gradient */}
      <div
        aria-hidden
        className={
          "pointer-events-none absolute inset-0 opacity-80 " +
          (isAccent
            ? "bg-[radial-gradient(circle_at_top,oklch(0.65_0.18_310/0.32),transparent_65%)]"
            : isCinema
              ? "bg-[radial-gradient(circle_at_top,oklch(0.62_0.22_25/0.28),transparent_65%)]"
              : "bg-[radial-gradient(circle_at_top,oklch(0.55_0.22_268/0.32),transparent_65%)]")
        }
      />

      {/* HERO IMAGE — large, meaningful, fills the top */}
      <div
        className={cn(
          "relative overflow-hidden",
          wide
            ? "aspect-video w-full sm:aspect-auto sm:min-h-72"
            : "m-3 aspect-square w-[6.5rem] shrink-0 self-center rounded-2xl sm:m-0 sm:w-full sm:rounded-none",
        )}
      >
        {hazard ? (
          <div className="grid h-full w-full place-items-center p-1.5 sm:p-3">
            <span
              aria-hidden="true"
              style={{
                background:
                  "radial-gradient(circle at 50% 28%, oklch(0.74 0.24 28), oklch(0.47 0.21 26) 66%, oklch(0.24 0.12 25))",
              }}
              className="hazard-create relative grid aspect-square w-[85%] place-items-center rounded-full border-[5px] border-destructive text-white"
            >
              <span
                className="hazard-ring absolute inset-1.5 rounded-full"
                style={{
                  background:
                    "repeating-conic-gradient(from 0deg, oklch(0.85 0.19 85 / 0.55) 0deg 18deg, transparent 18deg 36deg)",
                  WebkitMask:
                    "radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px))",
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px))",
                }}
              />
              <span className="hazard-core absolute inset-6 rounded-full bg-white/20 blur-md" />
              <span className="relative z-10 flex flex-col items-center gap-0.5">
                <Sparkles className="h-4 w-4 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:h-6 sm:w-6 lg:h-9 lg:w-9" />
                <span className="font-display text-[0.8rem] font-black uppercase leading-none [overflow-wrap:normal] drop-shadow-[0_3px_5px_rgba(0,0,0,0.9)] sm:text-xl md:text-2xl lg:text-4xl">
                  Create
                </span>
                <span className="font-display text-[0.6rem] font-black uppercase leading-none tracking-[0.18em] [overflow-wrap:normal] drop-shadow-[0_3px_5px_rgba(0,0,0,0.9)] sm:text-sm lg:text-2xl">
                  Now
                </span>
              </span>
            </span>
          </div>
        ) : (
          <img
            src={image}
            alt={imageAlt}
            loading="lazy"
            width={768}
            height={768}
            className={
              "h-full w-full object-cover transition-transform duration-700 group-hover:scale-110 " +
              (isAccent ? "p-1 sm:p-4 lg:p-6" : "")
            }
          />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden bg-gradient-to-t from-card via-card/30 to-transparent sm:block"
        />
        {/* Equalizer overlay only for music card */}
        {!isAccent && !isCinema && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-end gap-1 opacity-90">
            {[0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.45, 0.85, 0.55, 0.7].map((h, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-gradient-to-t from-primary/70 to-primary"
                style={{
                  height: `${h * 22}px`,
                  animation: `eqPulse 1.${(i % 6) + 2}s ease-in-out ${i * 0.08}s infinite alternate`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Text + CTA */}
      {/* break-word (not the global "anywhere") keeps whole words together. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-1 py-3 pr-1 [overflow-wrap:break-word] sm:justify-start sm:gap-2 sm:p-5">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-primary sm:text-xs sm:tracking-[0.22em]">
          {eyebrow}
        </p>
        <h3 className="font-display text-lg font-black uppercase leading-[1.08] tracking-tight text-foreground sm:text-2xl lg:text-3xl">
          {title}
        </h3>
        <p className="text-xs font-semibold uppercase leading-snug tracking-[0.08em] text-muted-foreground sm:text-sm sm:leading-relaxed sm:tracking-[0.12em]">
          {body}
        </p>
        <div className="mt-auto hidden grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pt-2 font-bold text-primary sm:grid sm:text-sm lg:text-base">
          <span className="min-w-0 rounded-full border-2 border-primary/40 bg-primary/15 px-2.5 py-1.5 leading-tight backdrop-blur-sm transition-colors group-hover:bg-primary/25 sm:px-4 sm:py-2">
            {cta}
          </span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 sm:h-5 sm:w-5" />
        </div>
      </div>
      {/* Phones: the whole row is the link, so a single arrow replaces the pill. */}
      <ArrowRight
        aria-hidden
        className="relative z-10 mr-4 h-5 w-5 shrink-0 self-center text-foreground transition-transform group-hover:translate-x-1 sm:hidden"
      />
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        className={cn(className, "w-full text-left")}
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      to={to ?? "/library"}
      search={search}
      hash={hazard ? "create" : undefined}
      preload="intent"
      className={className}
    >
      {content}
    </Link>
  );
}
