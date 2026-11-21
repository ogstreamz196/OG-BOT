import { lazy, Suspense } from "react";
import { createFileRoute, Link, Navigate, redirect } from "@tanstack/react-router";
import { Bot, Cpu, FlaskConical, Radio, Trophy, Wrench } from "lucide-react";
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

/** The deep tools, one tap from the Control Room (hidden tabs, so old links still work). */
const MORE_TOOLS: { tab: string; label: string }[] = [
  { tab: "results", label: "Full results & HFT lab" },
  { tab: "tweaker", label: "Tuning" },
  { tab: "backtest", label: "Backtest" },
  { tab: "bots", label: "Bot fleet & groups" },
  { tab: "mt5", label: "MT5 auto-trading" },
];

/**
 * The Signals Control Room (the Boss, 2026-11-21: "reconstruct the section for
 * all signal controls into a one page control room, remove the clutter … my
 * Boss controls for the signal Telegram group"). In order: the switchboard
 * with the live scan status (the same switches as the Copy Trader B0T's
 * card), purge & reset, the OG SIGNAL BOT tokens, the record, whether every
 * bot's Telegram link is up, and the members' web page switch. The deep tools
 * are a row of links at the bottom.
 */
function ControlRoom() {
  return (
    <>
      <TradingSwitchesPanel />
      <SignalsChatResetPanel />
      <SignalTokensPanel />
      <SignalRecordPanel />
      <WebhookKeeperPanel />
      <SignalsPortalPanel />
      <nav aria-label="More signal tools" className="mt-6 flex flex-wrap gap-2">
        {MORE_TOOLS.map((t) => (
          <Link
            key={t.tab}
            to="/admin/signals"
            search={{ tab: t.tab }}
            className="rounded-lg border border-border bg-card/60 px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            {t.label} →
          </Link>
        ))}
      </nav>
    </>
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
    label: "Control room",
    Icon: Radio,
    hint: "Everything that runs the signals group on one page: the switchboard, purge & reset, OG SIGNAL BOT tokens, the record and the bots.",
    Panel: ControlRoom,
  },
  {
    value: "tweaker",
    label: "Tuning",
    Icon: Wrench,
    hint: "Every signal knob, strategy and the learning data in one place.",
    Panel: TradeTweakerPanel,
    hidden: true,
  },
  {
    value: "results",
    label: "Results",
    Icon: Trophy,
    hint: "Each strategy's scoreboard, why trades lost, the HFT lab and the deep report.",
    Panel: Results,
    hidden: true,
  },
  {
    value: "backtest",
    label: "Backtest",
    Icon: FlaskConical,
    hint: "The take profit size compared on stored setups, and how signals would have done on past prices.",
    Panel: Backtest,
    hidden: true,
  },
  {
    value: "bots",
    label: "Bots",
    Icon: Bot,
    hint: "The main Telegram webhook, the worker bots and the groups they post in.",
    Panel: Bots,
    hidden: true,
  },
  {
    value: "mt5",
    label: "MT5 auto-trading",
    Icon: Cpu,
    hint: "The MetaApi auto-trading on the Boss's MT5 account (the copier on a PC or VPS is the main way now).",
    Panel: Mt5Panel,
    hidden: true,
  },
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
