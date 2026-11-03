import { lazy, Suspense } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Bot, FlaskConical, LineChart, SlidersHorizontal, Trophy } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { BossTabs, type BossTab } from "@/components/admin/BossTabs";
import { SignalsPortalPanel } from "@/components/admin/SignalsPortalPanel";
import { SignalsChatResetPanel } from "@/components/admin/SignalsChatResetPanel";
import { Mt5Panel } from "@/components/admin/Mt5Panel";
import { SignalRecordPanel } from "@/components/admin/SignalRecordPanel";
import { StrategyBoardPanel } from "@/components/admin/StrategyBoardPanel";
import { TargetComparePanel } from "@/components/admin/TargetComparePanel";
import { SignalReportPanel } from "@/components/admin/SignalReportPanel";
import { TelegramWebhookStatus } from "@/components/admin/TelegramWebhookStatus";
import { TelegramFleetPanel } from "@/components/admin/TelegramFleetPanel";
import { TelegramGroupsPanel } from "@/components/admin/TelegramGroupsPanel";

export const Route = createFileRoute("/_authenticated/admin/signals")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === "string" ? { tab: s.tab } : {},
  head: () => ({
    meta: [
      { title: "Signals | OG B0T Boss" },
      {
        name: "description",
        content: "Signals controls, results, reports, backtests and the bots that post them.",
      },
      { property: "og:title", content: "Signals | OG B0T Boss" },
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

/** The switches: the web portal, the demo account and MT5 auto-trading. */
function Controls() {
  return (
    <>
      <SignalsPortalPanel />
      <SignalsChatResetPanel />
      <Mt5Panel />
    </>
  );
}

/** The record, then how each strategy is doing. */
function Results() {
  return (
    <>
      <SignalRecordPanel />
      <StrategyBoardPanel />
    </>
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

/** The Telegram side: whether messages arrive, the worker fleet and the groups. */
function Bots() {
  return (
    <>
      <TelegramWebhookStatus />
      <TelegramFleetPanel />
      <TelegramGroupsPanel />
    </>
  );
}

const SIGNALS_TABS: readonly BossTab[] = [
  {
    value: "controls",
    label: "Controls",
    Icon: SlidersHorizontal,
    hint: "The web signals portal, the demo account (start fresh) and MT5 auto-trading.",
    Panel: Controls,
  },
  {
    value: "results",
    label: "Results",
    Icon: Trophy,
    hint: "The record: streak, win rate and the latest results, then each strategy's scoreboard.",
    Panel: Results,
  },
  {
    value: "report",
    label: "Report",
    Icon: LineChart,
    hint: "The deep breakdown: by chart, by session, by check and timing.",
    Panel: SignalReportPanel,
  },
  {
    value: "backtest",
    label: "Backtest",
    Icon: FlaskConical,
    hint: "The take profit size compared on stored setups, and how signals would have done on past prices.",
    Panel: Backtest,
  },
  {
    value: "bots",
    label: "Bots",
    Icon: Bot,
    hint: "Whether Telegram messages reach OG B0T, the worker bots and the groups they post in.",
    Panel: Bots,
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
    <DashboardShell title="Signals">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl">
        <BossNav />
        <BossTabs tabs={SIGNALS_TABS} />
      </div>
    </DashboardShell>
  );
}
