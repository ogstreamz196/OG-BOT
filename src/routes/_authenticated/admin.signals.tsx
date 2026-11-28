import React, { lazy, Suspense, useState } from "react";
import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { Radio } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { SignalsPortalPanel } from "@/components/admin/SignalsPortalPanel";
import { SignalsChatResetPanel } from "@/components/admin/SignalsChatResetPanel";
import { Mt5Panel } from "@/components/admin/Mt5Panel";
import { TradingSwitchesPanel } from "@/components/admin/TradingSwitchesPanel";
import { HftLabPanel } from "@/components/admin/HftLabPanel";
import { LossAutopsyPanel } from "@/components/admin/LossAutopsyPanel";
import { ToolSection } from "@/components/admin/ToolSection";
import { SignalRecordPanel } from "@/components/admin/SignalRecordPanel";
import { StrategyBoardPanel } from "@/components/admin/StrategyBoardPanel";
import { TargetComparePanel } from "@/components/admin/TargetComparePanel";
import { SignalReportPanel } from "@/components/admin/SignalReportPanel";
import { TradeTweakerPanel } from "@/components/admin/TradeTweakerPanel";
import { TelegramWebhookStatus } from "@/components/admin/TelegramWebhookStatus";
import { TelegramFleetPanel } from "@/components/admin/TelegramFleetPanel";
import { WebhookKeeperPanel } from "@/components/admin/WebhookKeeperPanel";
import { TelegramGroupsPanel } from "@/components/admin/TelegramGroupsPanel";
import { SignalTokensPanel } from "@/components/admin/SignalTokensPanel";

export const Route = createFileRoute("/_authenticated/admin/signals")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  // Report joined Results (the Boss, 2026-11-13): old links follow.
  beforeLoad: ({ search }) => {
    // Website only: trading switches, copier tokens and MT5 stay out of the
    // phone apps (store rules; native-policy.ts).
    if (typeof window !== "undefined" && Capacitor.isNativePlatform())
      throw redirect({ to: "/admin" });
    if (search.tab === "report")
      throw redirect({ to: "/admin/signals", search: { tab: "results" } });
  },
  head: () => ({
    meta: [
      { title: "Signals Control Room | OG B0T Boss" },
      {
        name: "description",
        content:
          "One page to run the signals group: the switchboard, purge & reset, OG SIGNAL BOT tokens, the record and the bots.",
      },
      { property: "og:title", content: "Signals Control Room | OG B0T Boss" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminSignalsPage,
});

// The backtest pulls in the whole signal engine, so it loads only when opened.
const SignalsBacktestPanel = lazy(() =>
  import("@/components/admin/SignalsBacktestPanel").then((m) => ({
    default: m.SignalsBacktestPanel,
  })),
);

type SectionKey =
  | "switches"
  | "reset"
  | "mt5"
  | "bots"
  | "tokens"
  | "record"
  | "members"
  | "results"
  | "tuning"
  | "backtest";

/**
 * Everything that runs the signals group, on one page (the Boss, 2026-11-28: "merge all signal stuff
 * under 1 tab"). Each area is a collapsible section; one opens at a time, and a section loads its
 * panels only when it's opened. Old tab links still work: they open their section here.
 */
const SECTIONS: { key: SectionKey; title: string; hint: string; body: () => React.ReactNode }[] = [
  { key: "switches", title: "Switchboard & live scan", hint: "Turn signals, copying, HFT and the members' switches on and off.", body: () => <TradingSwitchesPanel /> },
  { key: "reset", title: "Purge & reset", hint: "Clear the signals group and restart the counter, from your real balance.", body: () => <SignalsChatResetPanel /> },
  { key: "mt5", title: "MT5 account & auto-trading", hint: "Connect demo or live MetaApi, and turn auto-trading on or off.", body: () => <Mt5Panel /> },
  {
    key: "bots",
    title: "Copy trader & Telegram bots",
    hint: "The copy trade bot, the worker bots and the groups they post in.",
    body: () => (
      <>
        <WebhookKeeperPanel />
        <TelegramWebhookStatus />
        <TelegramFleetPanel />
        <TelegramGroupsPanel />
      </>
    ),
  },
  { key: "tokens", title: "OG SIGNAL BOT tokens", hint: "Tokens sold to members to connect their own devices.", body: () => <SignalTokensPanel /> },
  { key: "record", title: "Record", hint: "The win and loss record every signal counts toward.", body: () => <SignalRecordPanel /> },
  { key: "members", title: "Members' web page", hint: "Whether members can open the signals board on the website.", body: () => <SignalsPortalPanel /> },
  { key: "results", title: "Results & HFT lab", hint: "Each strategy's scoreboard, why trades lost, the HFT lab and the deep report.", body: () => <Results /> },
  { key: "tuning", title: "Tuning", hint: "Every signal knob, strategy and the learning data in one place.", body: () => <TradeTweakerPanel /> },
  { key: "backtest", title: "Backtest", hint: "Take profit sizes on stored setups, and how signals would have done on past prices.", body: () => <Backtest /> },
];

/** One collapsible page for everything that runs the signals group. `open` opens one section first. */
function ControlRoom({ open }: { open?: SectionKey }) {
  const [current, setCurrent] = useState<SectionKey | null>(open ?? "switches");
  return (
    <div className="space-y-2" aria-label="Signals control room">
      {SECTIONS.map((sec) => {
        const isOpen = current === sec.key;
        return (
          <section key={sec.key} className={`overflow-hidden rounded-2xl border bg-card/60 ${isOpen ? "border-primary/50" : "border-border"}`}>
            <button
              type="button"
              className="flex w-full items-center gap-3 p-4 text-left"
              aria-expanded={isOpen}
              onClick={() => setCurrent(isOpen ? null : sec.key)}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-bold text-foreground">{sec.title}</span>
                <span className="text-sm text-muted-foreground">{sec.hint}</span>
              </span>
              <span aria-hidden="true" className={`text-xl text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
            </button>
            {isOpen ? (
              <div className="space-y-4 border-t border-border p-4">
                <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}>
                  {sec.body()}
                </Suspense>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** How each strategy is doing, then the full breakdown (was Report). The record is on the Control Room. */
function Results() {
  return (
    <div className="space-y-8">
      <ToolSection title="Strategies" desc="Each strategy's scoreboard, best first.">
        <StrategyBoardPanel />
      </ToolSection>
      <ToolSection
        title="Why trades lost"
        desc="Each loss checked against what price did next, with the lesson for each strategy."
      >
        <LossAutopsyPanel />
      </ToolSection>
      <ToolSection
        title="HFT lab"
        desc="Quick-trade strategies scored every minute on live prices after the spread. Watch only."
      >
        <HftLabPanel />
      </ToolSection>
      <ToolSection
        title="Report"
        desc="The deep breakdown: by chart, by session, by check and timing."
      >
        <SignalReportPanel />
      </ToolSection>
    </div>
  );
}

function Backtest() {
  return (
    <>
      <TargetComparePanel />
      <Suspense
        fallback={<div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>}
      >
        <SignalsBacktestPanel />
      </Suspense>
    </>
  );
}

/** The Telegram side: the main webhook, the worker fleet and the groups (bot links are on the Control Room). */
function Bots() {
  return (
    <>
      <TelegramWebhookStatus />
      <TelegramFleetPanel />
      <TelegramGroupsPanel />
    </>
  );
}

// One page (the Control Room) in the bar; the deep tools are hidden tabs it
// links to, so every old ?tab= link and the Boss search still land.
const SIGNALS_TABS: readonly BossTab[] = [
  {
    value: "controls",
    label: "Signals",
    Icon: Radio,
    hint: "Everything that runs the signals group, on one page.",
    Panel: () => <ControlRoom />,
  },
  { value: "tweaker", label: "tweaker", Icon: Radio, hint: "Now part of Signals.", Panel: () => <ControlRoom open="tuning" />, hidden: true },
  { value: "results", label: "results", Icon: Radio, hint: "Now part of Signals.", Panel: () => <ControlRoom open="results" />, hidden: true },
  { value: "backtest", label: "backtest", Icon: Radio, hint: "Now part of Signals.", Panel: () => <ControlRoom open="backtest" />, hidden: true },
  { value: "bots", label: "bots", Icon: Radio, hint: "Now part of Signals.", Panel: () => <ControlRoom open="bots" />, hidden: true },
  { value: "mt5", label: "mt5", Icon: Radio, hint: "Now part of Signals.", Panel: () => <ControlRoom open="mt5" />, hidden: true },
];

function AdminSignalsPage() {
  const { isAdmin, isLoading } = useRole();
  if (isLoading) {
    return (
      <DashboardShell title="Signals">
        <div className="py-24 text-center text-sm text-muted-foreground">
          Checking admin access…
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;
  return (
    <DashboardShell title="Signals Control Room">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={SIGNALS_TABS} />
      </div>
    </DashboardShell>
  );
}
