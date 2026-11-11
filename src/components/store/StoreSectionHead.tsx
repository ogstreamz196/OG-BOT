import type { CSSProperties, ReactNode } from "react";

/** Section heading used across the Store (eyebrow, title, accent bar). */
export function StoreSectionHead({
  id,
  eyebrow,
  title,
  accent,
  aside,
}: {
  id: string;
  eyebrow: string;
  title: string;
  accent: "gold" | "purple" | "blue";
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5">
      <div className="min-w-0">
        <p className="og-store__eyebrow">{eyebrow}</p>
        <h2
          id={id}
          className="og-store__title mt-1 text-[clamp(1.6rem,6vw,2.25rem)] leading-none"
          style={{ "--a1": `var(--st-${accent})` } as CSSProperties}
        >
          {title}
        </h2>
        <span aria-hidden className={`og-store-head-bar og-store-head-bar--${accent}`} />
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
