import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AdminSectionProps {
  icon?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Override outer padding (defaults to p-5). */
  padding?: string;
  /** Slightly muted card tone, matches the previous bg-card/70 look. */
  muted?: boolean;
  /** Disable the default mb-6 spacing. */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Shared card shell for admin panels. Standardises radius, border,
 * shadow and the icon + title + subtitle header used across the
 * Admin Controls page.
 */
export function AdminSection({
  icon,
  title,
  subtitle,
  action,
  padding = "p-5",
  muted = false,
  flush = false,
  className,
  children,
}: AdminSectionProps) {
  const hasHeader = !!(icon || title || subtitle || action);
  return (
    <section
      // A plain-text title makes this a stop in the tab's "On this page" row (SectionJump).
      data-boss-section={typeof title === "string" ? title : undefined}
      className={cn(
        "scroll-mt-36 rounded-2xl border border-border shadow-card",
        muted ? "bg-card/70" : "bg-card",
        padding,
        !flush && "mb-6",
        className,
      )}
    >
      {hasHeader && (
        <header className="mb-4 flex flex-wrap items-center gap-3">
          {icon && (
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15">
              {icon}
            </div>
          )}
          <div className="min-w-[10rem] flex-1 basis-[12rem]">
            {title && <h3 className="font-semibold leading-tight">{title}</h3>}
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
