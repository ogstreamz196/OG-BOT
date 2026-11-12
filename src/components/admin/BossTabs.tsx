import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { centerActiveChild } from "@/components/admin/BossNav";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionJump } from "@/components/admin/SectionJump";

export type BossTab = {
  value: string;
  label: string;
  Icon: LucideIcon;
  /** One line under the tab bar saying what this tab is for. */
  hint?: string;
  Panel: ComponentType;
};

/** Where the last open tab of each Boss area is remembered (this browser only). */
const lastTabKey = (path: string) => `og-boss-tab:${path}`;

function readLastTab(path: string): string | null {
  try {
    return window.localStorage.getItem(lastTabKey(path));
  } catch {
    return null;
  }
}

function saveLastTab(path: string, tab: string) {
  try {
    window.localStorage.setItem(lastTabKey(path), tab);
  } catch {
    // Private mode or blocked storage: just don't remember.
  }
}

/**
 * Tab strip used by every Boss area page. The open tab is kept in `?tab=` so
 * the dashboard can link straight to it and a refresh stays put. Opening an
 * area without `?tab=` goes back to the tab you last had open there. On phones
 * the strip is a dropdown, so every tab is one tap away without scrolling.
 */
export function BossTabs({ tabs, intro }: { tabs: readonly BossTab[]; intro?: ReactNode }) {
  const routerTab = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown> | undefined)?.tab,
  });
  const path = useRouterState({ select: (s) => s.location.pathname });
  const pick = (t: unknown) =>
    typeof t === "string" && tabs.some((x) => x.value === t) ? t : tabs[0].value;
  const [tab, setTab] = useState(() => pick(routerTab));
  // Follow ?tab= when a link (e.g. the Boss search) opens another tab on this page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setTab(pick(routerTab)), [routerTab]);
  const current = tabs.find((t) => t.value === tab) ?? tabs[0];
  const listRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  useEffect(() => centerActiveChild(listRef.current, '[data-state="active"]'), [tab]);
  const navigate = useNavigate();

  // No ?tab= in the link: reopen the tab last used in this area (after load,
  // so the server and the browser draw the same first page).
  useEffect(() => {
    if (routerTab !== undefined) return;
    const last = readLastTab(path);
    if (last && last !== tab && tabs.some((t) => t.value === last)) select(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  function select(next: string) {
    setTab(next);
    saveLastTab(path, next);
    // Through the router (not history directly) so it knows the open tab.
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, tab: next }),
      replace: true,
      resetScroll: false,
    });
  }

  return (
    <Tabs value={tab} onValueChange={select} className="w-full">
      {intro}
      <label className="mb-2 block sm:hidden">
        <span className="sr-only">Section</span>
        <select
          value={tab}
          onChange={(e) => select(e.target.value)}
          className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm font-bold text-foreground"
        >
          {tabs.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <TabsList
        ref={listRef}
        className="relative mb-2 hidden h-auto sm:flex w-full justify-start gap-4 overflow-x-auto whitespace-nowrap rounded-none border-0 border-b border-border/60 bg-transparent p-0 [scrollbar-width:none]"
      >
        {tabs.map(({ value, label, Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="flex shrink-0 items-center gap-2 rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-0 text-sm font-bold text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <Icon className="h-4 w-4" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {current.hint && <p className="mb-4 text-sm text-muted-foreground">{current.hint}</p>}
      {/* Jump chips for the open tab's sections (only when it has three or more). */}
      <SectionJump key={tab} within={panelsRef} />
      <div ref={panelsRef}>
        {tabs.map(({ value, Panel }) => (
          <TabsContent key={value} value={value} className="mt-0 min-w-0 space-y-4">
            <Panel />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
