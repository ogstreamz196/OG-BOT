import sportsGuideArt from "@/assets/og-bot-sports-guide-badge.webp";

/** Small eyebrow + display title used to open each section below the hero. */
export function SectionHeading({
  id,
  eyebrow,
  title,
}: {
  id: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="text-center">
      <p className="text-xs font-black uppercase tracking-[0.3em] text-foreground/75 sm:text-sm">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="font-display mt-2 text-balance text-3xl font-black leading-[0.95] tracking-tight sm:text-5xl"
      >
        {title}
      </h2>
    </div>
  );
}

/**
 * The Sports Guide card, shared by the landing page (opens sign-in) and the
 * members' home (opens the guide). The whole card is one tap target.
 */
export function SportsGuideFeature({
  onOpen,
  tag = "Members only",
}: {
  onOpen: () => void;
  tag?: string;
}) {
  const btn =
    "min-h-11 items-center gap-2 rounded-xl bg-accent px-5 pt-0.5 text-sm font-black uppercase tracking-wide text-accent-foreground transition after:absolute after:inset-0 after:z-10 after:content-[''] active:transform-none focus-visible:outline-none";
  return (
    <article className="group relative mt-6 overflow-hidden rounded-3xl border border-white/12 bg-card/90 p-4 shadow-card backdrop-blur-xl transition focus-within:ring-2 focus-within:ring-accent hover:border-accent/60 sm:mt-8 sm:p-6">
      <div className="flex items-center gap-4 sm:gap-6">
        <img
          src={sportsGuideArt}
          alt="OG Bot Sports Guide badge"
          width={480}
          height={480}
          loading="lazy"
          decoding="async"
          className="h-24 w-24 shrink-0 rounded-2xl object-cover sm:h-36 sm:w-36"
        />
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.18em] text-foreground/85 sm:text-xs">
            {tag}
          </p>
          <h3 className="font-display mt-2 text-2xl font-black uppercase leading-none sm:text-4xl">
            Sports Guide
          </h3>
          <p className="mt-2 text-sm leading-snug text-foreground/85 sm:text-base">
            Daily fixtures, fight cards and TV listings. Search any team in seconds.
          </p>
          <button
            type="button"
            onClick={onOpen}
            className={`${btn} mt-4 hidden group-hover:ring-2 group-hover:ring-white/25 sm:inline-flex`}
          >
            Open Sports Guide <span aria-hidden>→</span>
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className={`${btn} mt-4 flex w-full justify-center sm:hidden`}
      >
        Open Sports Guide <span aria-hidden>→</span>
      </button>
    </article>
  );
}
