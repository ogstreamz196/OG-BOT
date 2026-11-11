import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

const DEVICES = [
  { label: "iPhone SE", w: 375, h: 667 },
  { label: "iPhone 13/14", w: 390, h: 844 },
  { label: "iPhone 14 Pro Max", w: 430, h: 932 },
  { label: "Galaxy S8", w: 360, h: 740 },
  { label: "Galaxy S22+", w: 384, h: 854 },
  { label: "Pixel 7", w: 412, h: 915 },
] as const;

const ROUTES = [
  "/",
  "/welcome",
  "/auth",
  "/library",
  "/buy-coins",
  "/referrals",
  "/settings",
  "/messenger",

  "/developer",
  "/admin",
  "/trust",
];

export const Route = createFileRoute("/m-preview")({
  component: MobilePreview,
  head: () => ({ meta: [{ title: "Mobile preview | OG B0T — AI Songs & Diss Tracks" }] }),
});

function MobilePreview() {
  const [route, setRoute] = useState<string>("/");
  const [custom, setCustom] = useState<string>("");
  const target = useMemo(() => (custom.trim() ? custom.trim() : route), [custom, route]);

  return (
    <div className="safe-top safe-bottom safe-x min-h-dvh bg-background">
      <header className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 pt-4 sm:flex sm:items-end sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold sm:text-2xl">Mobile preview</h1>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">
            Spot-check every route at iPhone &amp; Samsung widths.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            aria-label="Pick a route"
          >
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="/custom?path"
            className="w-48 rounded-md border border-border bg-background px-2 py-1 text-sm"
            aria-label="Custom path"
          />
        </div>
      </header>

      <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-10 sm:px-6">
        {DEVICES.map((d) => (
          <figure key={d.label} className="shrink-0 snap-start">
            <figcaption className="mb-2 text-xs text-muted-foreground">
              {d.label} — {d.w}×{d.h}
            </figcaption>
            <div
              className="overflow-hidden rounded-[2rem] border-[10px] border-foreground/80 bg-black shadow-2xl"
              style={{ width: d.w, height: d.h }}
            >
              <iframe
                key={`${d.label}:${target}`}
                title={`${d.label} preview of ${target}`}
                src={target}
                className="h-full w-full border-0 bg-background"
              />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
