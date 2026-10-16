import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { centerActiveChild } from "@/components/admin/BossNav";
import { useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type BossTab = {
  value: string;
  label: string;
  Icon: LucideIcon;
  /** One line under the tab bar saying what this tab is for. */
  hint?: string;
  Panel: ComponentType;
};

/**
 * Tab strip used by every Boss area page. The open tab is kept in `?tab=` so
 * the dashboard can link straight to it and a refresh stays put.
 */
export function BossTabs({ tabs, intro }: { tabs: readonly BossTab[]; intro?: ReactNode }) {
  const initial = useRouterState({
    select: (s) => {
      const t = (s.location.search as Record<string, unknown> | undefined)?.tab;
      return typeof t === "string" && tabs.some((x) => x.value === t) ? t : tabs[0].value;
    },
  });
  const [tab, setTab] = useState(initial);
  const current = tabs.find((t) => t.value === tab) ?? tabs[0];
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => centerActiveChild(listRef.current, '[data-state="active"]'), [tab]);

  function select(next: string) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* address bar sync is a convenience only */
    }
  }

  return (
    <Tabs value={tab} onValueChange={select} className="w-full">
      {intro}
      <TabsList
        ref={listRef}
        className="relative mb-2 flex h-auto w-full justify-start gap-4 overflow-x-auto whitespace-nowrap rounded-none border-0 border-b border-border/60 bg-transparent p-0 [scrollbar-width:none]"
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
      {tabs.map(({ value, Panel }) => (
        <TabsContent key={value} value={value} className="mt-0 min-w-0 space-y-4">
          <Panel />
        </TabsContent>
      ))}
    </Tabs>
  );
}
