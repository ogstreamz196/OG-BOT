import type { ReactNode } from "react";

/**
 * A titled block inside a Boss tab that holds more than one panel. It marks
 * itself with data-boss-section so the tab's "On this page" row can jump to it.
 */
export function ToolSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section data-boss-section={title} className="min-w-0 scroll-mt-36 space-y-3">
      <div>
        <h2 className="text-lg leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {children}
    </section>
  );
}
