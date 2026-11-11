"use client";

// The full Markdown renderer for chat replies, loaded on demand by
// MessageResponse (message.tsx). Code highlighting, maths and diagrams are
// heavy (~1.5MB together), so each plugin is fetched only once a message
// actually contains a code block, a formula or a diagram.
import { cjk } from "@streamdown/cjk";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

type Plugins = NonNullable<ComponentProps<typeof Streamdown>["plugins"]>;
type Extra = "code" | "math" | "mermaid";

const loaders: Record<Extra, () => Promise<Partial<Plugins>>> = {
  code: () => import("@streamdown/code").then((m) => ({ code: m.code })),
  math: () => import("@streamdown/math").then((m) => ({ math: m.math })),
  mermaid: () => import("@streamdown/mermaid").then((m) => ({ mermaid: m.mermaid })),
};

// Shared by every message: each plugin loads once per page.
const loaded: Partial<Plugins> = { cjk };
const pending = new Map<Extra, Promise<void>>();

/** Which extra plugins a reply needs. */
export function neededPlugins(text: string): Extra[] {
  const out: Extra[] = [];
  if (/```\s*mermaid/i.test(text)) out.push("mermaid");
  if (text.includes("```")) out.push("code");
  if (/\$\$|\\\(|\\\[/.test(text)) out.push("math");
  return out;
}

function usePlugins(text: string): Plugins {
  const needed = neededPlugins(text).filter((p) => !(p in loaded));
  const [, setVersion] = useState(0);
  const key = needed.join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void Promise.all(
      (key.split(",") as Extra[]).map((p) => {
        let job = pending.get(p);
        if (!job) {
          job = loaders[p]().then((m) => void Object.assign(loaded, m));
          pending.set(p, job);
        }
        return job;
      }),
    ).then(() => alive && setVersion((v) => v + 1));
    return () => {
      alive = false;
    };
  }, [key]);
  return { ...loaded } as Plugins;
}

export default function MessageResponseFull({
  className,
  children,
  ...props
}: ComponentProps<typeof Streamdown>) {
  const plugins = usePlugins(typeof children === "string" ? children : "");
  return (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={plugins}
      {...props}
    >
      {children}
    </Streamdown>
  );
}
