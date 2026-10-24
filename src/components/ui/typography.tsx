import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared premium typography + layout primitives.
 *
 * Use these instead of copy-pasting long className strings across routes.
 * Each component is a thin wrapper over the matching `text-*` / `section-*`
 * utility defined in src/styles.css, so the styling stays in one place.
 *
 * Examples:
 *   <Display>Make a Track</Display>
 *   <Heading level={2}>Choose the vibe</Heading>
 *   <Kicker>Curated for you</Kicker>
 *   <Body size="lg">Tonight's mood, dialed in.</Body>
 *   <Section><SectionInner>…</SectionInner></Section>
 */

type AsProp<T extends React.ElementType> = { as?: T };
type PolymorphicProps<T extends React.ElementType, P = unknown> = AsProp<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof AsProp<T> | keyof P> &
  P;

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

export function Display<T extends React.ElementType = "h1">({
  as,
  className,
  cartoon = false,
  ...rest
}: PolymorphicProps<T, { cartoon?: boolean }>) {
  const Tag = (as ?? "h1") as React.ElementType;
  return (
    <Tag
      className={cn("text-display text-foreground", cartoon && "font-cartoon", className)}
      {...rest}
    />
  );
}

/**
 * <StickerCard> — sticker tile for the "feel like a child again" polish:
 * thick black border, hard-edge offset shadow, optional tilt, springy hover.
 * Compose with brand color utilities (bg-primary, bg-destructive, etc).
 */
export function StickerCard({
  className,
  tilt,
  hover = true,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  tilt?: "left" | "right" | "none";
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "sticker-card",
        hover && "sticker-card-hover",
        tilt === "left" && "tilt-l",
        tilt === "right" && "tilt-r",
        className,
      )}
      {...rest}
    />
  );
}

type HeadingLevel = 1 | 2 | 3;
type HeadingProps = PolymorphicProps<React.ElementType, { level?: HeadingLevel }>;
export function Heading({ as, level = 2, className, ...rest }: HeadingProps) {
  const Tag = as ?? (`h${level}` as React.ElementType);
  const sizeClass = level === 1 ? "text-h1" : level === 2 ? "text-h2" : "text-h3";
  return <Tag className={cn(sizeClass, "text-foreground", className)} {...rest} />;
}

type BodySize = "lg" | "md" | "sm";
type BodyProps = PolymorphicProps<React.ElementType, { size?: BodySize }>;
export function Body({ as, size = "md", className, ...rest }: BodyProps) {
  const Tag = (as ?? "p") as React.ElementType;
  const sizeClass = size === "lg" ? "text-body-lg" : size === "sm" ? "text-body-sm" : "text-body";
  return <Tag className={cn(sizeClass, "text-foreground/85", className)} {...rest} />;
}

export function Kicker<T extends React.ElementType = "span">({
  as,
  className,
  ...rest
}: PolymorphicProps<T>) {
  const Tag = (as ?? "span") as React.ElementType;
  return <Tag className={cn("text-kicker", className)} {...rest} />;
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

type SectionProps = PolymorphicProps<React.ElementType, { tight?: boolean; bleed?: boolean }>;
export function Section({ as, tight = false, bleed = false, className, ...rest }: SectionProps) {
  const Tag = (as ?? "section") as React.ElementType;
  return (
    <Tag
      className={cn(
        tight ? "section-pad-tight" : "section-pad",
        !bleed && "container-app",
        className,
      )}
      {...rest}
    />
  );
}

export function SectionStack({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("section-stack", className)} {...rest} />;
}
