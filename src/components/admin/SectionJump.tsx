import { useEffect, useState, type RefObject } from "react";

/** A section a Boss page offers a jump to (AdminSection and friends mark themselves). */
export const SECTION_ATTR = "data-boss-section";

/** The top-level marked sections showing inside `root`, in page order. */
export function findSections(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(`[${SECTION_ATTR}]`)).filter(
    (el) =>
      !!el.getAttribute(SECTION_ATTR) &&
      // A section inside another marked section is part of it, not its own stop.
      !el.parentElement?.closest(`[${SECTION_ATTR}]`),
  );
}

/**
 * "On this page": one chip per section of the open Boss tab, so a long tab
 * (TradeTweaker, Tools & logs, Bots) doesn't have to be scrolled through to
 * find something. Shows only when there are three or more sections; a tap
 * scrolls to that section. It only reads the page, so nothing else changes.
 */
export function SectionJump({ within }: { within: RefObject<HTMLElement | null> }) {
  const [titles, setTitles] = useState<string[]>([]);

  useEffect(() => {
    const root = within.current;
    if (!root) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = findSections(root).map((el) => el.getAttribute(SECTION_ATTR) ?? "");
      setTitles((prev) => (prev.join("\n") === next.join("\n") ? prev : next));
    };
    read();
    // Panels load their data after the tab opens, so keep the list in step.
    const watch = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(read);
    });
    watch.observe(root, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [within]);

  if (titles.length < 3) return null;
  return (
    <nav aria-label="On this page" className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">On this page:</span>
      {titles.map((title, i) => (
        <button
          key={`${i}-${title}`}
          type="button"
          title={title}
          onClick={() =>
            findSections(within.current)[i]?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="max-w-[15rem] truncate rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
        >
          {title}
        </button>
      ))}
    </nav>
  );
}
