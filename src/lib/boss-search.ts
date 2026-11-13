/**
 * What the Boss search box can find: every Boss area, every tab and the
 * switches inside them, plus a few of your own settings. Each entry opens the
 * exact tab (`?tab=`) it lives on. boss-search.test.ts checks every tab here
 * really exists, so a renamed tab can't leave a dead result behind.
 */
export type BossPath =
  | "/admin"
  | "/admin/users"
  | "/admin/music"
  | "/admin/coins"
  | "/admin/signals"
  | "/admin/system"
  | "/settings";

export type BossSetting = {
  title: string;
  /** Where it lives, e.g. "Signals › Controls". */
  where: string;
  to: BossPath;
  tab?: string;
  /** Section id on the page (Settings only). */
  hash?: string;
  /** Other words people might type for it. */
  keywords?: string;
};

const area = (name: string, tab: string) => `${name} › ${tab}`;

export const BOSS_SETTINGS: readonly BossSetting[] = [
  // Members
  {
    title: "Members",
    where: "Members",
    to: "/admin/users",
    keywords: "users people accounts find member list",
  },
  {
    title: "Give or take coins",
    where: "Members › pick a member",
    to: "/admin/users",
    keywords: "grant coins mint balance adjust add remove set balance",
  },
  {
    title: "VIP, Boss and Dev roles",
    where: "Members › pick a member",
    to: "/admin/users",
    keywords: "vip switch admin role boss dev trial vault access",
  },

  // Music
  {
    title: "Live tracks",
    where: area("Music", "Live tracks"),
    to: "/admin/music",
    tab: "tracks",
    keywords: "songs retry unlock lock generating stuck",
  },
  {
    title: "Failed songs",
    where: area("Music", "Failures"),
    to: "/admin/music",
    tab: "failures",
    keywords: "errors provider failed generation",
  },
  {
    title: "Songs on Google Drive",
    where: area("Music", "Drive"),
    to: "/admin/music",
    tab: "drive",
    keywords: "drive storage move songs google backup mp3",
  },
  {
    title: "Language & genre portals",
    where: area("Music", "Portals"),
    to: "/admin/music",
    tab: "portals",
    keywords: "open close maintenance switch portal",
  },

  // Money
  {
    title: "Coin overview",
    where: area("Money", "Overview"),
    to: "/admin/coins",
    tab: "overview",
    keywords: "coins supply holders",
  },
  {
    title: "Prices & limits",
    where: area("Money", "Prices & store"),
    to: "/admin/coins",
    tab: "prices",
    keywords: "cost charge pricing song price limits",
  },
  {
    title: "OG Store",
    where: area("Money", "Prices & store"),
    to: "/admin/coins",
    tab: "prices",
    keywords: "shop items stock categories products",
  },
  {
    title: "Card payments",
    where: area("Money", "Payments"),
    to: "/admin/coins",
    tab: "payments",
    keywords: "stripe refunds accountant purchases",
  },
  {
    title: "Stripe payments webhook",
    where: area("Money", "Payments"),
    to: "/admin/coins",
    tab: "payments",
    keywords: "payments webhook stripe events credited",
  },
  {
    title: "Coin check",
    where: area("Money", "Checks"),
    to: "/admin/coins",
    tab: "checks",
    keywords: "audit mismatch balance history reconcile",
  },
  {
    title: "Referrals",
    where: area("Money", "Checks"),
    to: "/admin/coins",
    tab: "checks",
    keywords: "invite codes leaders",
  },

  // OG B0T
  {
    title: "OG B0T persona",
    where: area("System", "OG B0T"),
    to: "/admin/system",
    tab: "bot",
    keywords: "script system prompt voice dictionary how it talks",
  },
  {
    title: "Telegram worker bots",
    where: area("Signals", "Bots"),
    to: "/admin/signals",
    tab: "bots",
    keywords: "fleet workers bot tokens on off switch webhook",
  },
  {
    title: "Signals demo account & start fresh",
    where: area("Signals", "Controls"),
    to: "/admin/signals",
    tab: "controls",
    keywords: "1000 demo test account balance purge signals chat vantage reset fresh start",
  },
  {
    title: "Telegram groups",
    where: area("Signals", "Bots"),
    to: "/admin/signals",
    tab: "bots",
    keywords: "group chats worker switches",
  },
  {
    title: "Your Telegram alerts",
    where: area("System", "OG B0T"),
    to: "/admin/system",
    tab: "bot",
    keywords: "notifications notify events switches",
  },
  {
    title: "Signals portal on/off",
    where: area("Signals", "Controls"),
    to: "/admin/signals",
    tab: "controls",
    keywords: "trade signals switch btc gold xau",
  },
  {
    title: "MT5 auto-trade",
    where: area("Signals", "Controls"),
    to: "/admin/signals",
    tab: "controls",
    keywords: "metatrader mt5 auto trade switch",
  },
  {
    title: "Signal results",
    where: area("Signals", "Results"),
    to: "/admin/signals",
    tab: "results",
    keywords: "record wins losses streak win rate history",
  },
  {
    title: "Signal report",
    where: area("Signals", "Report"),
    to: "/admin/signals",
    tab: "report",
    keywords: "breakdown by chart session check timing strategies",
  },
  {
    title: "Signal backtest",
    where: area("Signals", "Backtest"),
    to: "/admin/signals",
    tab: "backtest",
    keywords: "test past prices history simulate",
  },
  {
    title: "Telegram webhook status",
    where: area("Signals", "Bots"),
    to: "/admin/signals",
    tab: "bots",
    keywords: "messages arriving webhook telegram connected",
  },
  {
    title: "Live users",
    where: area("System", "Health"),
    to: "/admin/system",
    tab: "health",
    keywords: "online now speak as og bot",
  },
  {
    title: "Bot health & AI usage",
    where: area("System", "Health"),
    to: "/admin/system",
    tab: "health",
    keywords: "ping gemini cost answering",
  },

  // System
  {
    title: "Free access for everyone",
    where: "Dashboard › Free VIP for all",
    to: "/admin/system",
    tab: "access",
    keywords: "vip for all switch promo open",
  },
  {
    title: "API keys",
    where: area("System", "Health › API keys"),
    to: "/admin/system",
    tab: "health",
    keywords: "services connectors ping secrets",
  },
  {
    title: "API vault (extra free AI keys)",
    where: area("System", "Health › API keys"),
    to: "/admin/system",
    tab: "health",
    keywords: "add key pollinations openrouter gemini free ai more keys",
  },
  {
    title: "Ledgerly",
    where: area("System", "Health › API keys"),
    to: "/admin/system",
    tab: "health",
    keywords: "accounts bookkeeping switch",
  },
  {
    title: "OG Vault webhook",
    where: area("System", "Health › API keys"),
    to: "/admin/system",
    tab: "health",
    keywords: "vault pass sync switch",
  },
  {
    title: "Setup checklist",
    where: area("System", "Developer"),
    to: "/admin/system",
    tab: "developer",
    keywords: "onboarding connectors secrets",
  },
  {
    title: "Diagnostics",
    where: area("System", "Tools & logs"),
    to: "/admin/system",
    tab: "tools",
    keywords: "smoke test check telegram foul mouth",
  },
  {
    title: "Boss actions log",
    where: area("System", "Tools & logs"),
    to: "/admin/system",
    tab: "tools",
    keywords: "audit history who did what",
  },
  {
    title: "Route map, lyric debug & transfer",
    where: area("System", "Developer"),
    to: "/admin/system",
    tab: "developer",
    keywords: "route map lyric debug transfer readiness",
  },

  // Your own settings
  {
    title: "Foul mouth mode (your chats)",
    where: "Settings › Preferences",
    to: "/settings",
    hash: "preferences",
    keywords: "swearing language filter switch",
  },
  {
    title: "Your profile",
    where: "Settings › Profile",
    to: "/settings",
    hash: "profile",
    keywords: "name avatar vip id",
  },
];

/** Shared by the Members list and the Boss search. */
export type SearchableMember = {
  id: string;
  email: string | null;
  display_name: string | null;
  telegram_username: string | null;
  og_vip_id: string | null;
};

export function memberMatches(m: SearchableMember, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const bare = needle.replace(/^@/, "");
  return (
    (m.email ?? "").toLowerCase().includes(needle) ||
    (m.display_name ?? "").toLowerCase().includes(needle) ||
    (m.telegram_username ?? "").toLowerCase().includes(bare) ||
    (m.og_vip_id ?? "").toLowerCase().includes(needle) ||
    m.id.toLowerCase().startsWith(needle)
  );
}

/**
 * Settings matching every word typed, best first: a title hit beats a
 * "where" hit, which beats a keyword hit.
 */
export function searchSettings(query: string, limit = 8): BossSetting[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = BOSS_SETTINGS.map((s) => {
    const title = s.title.toLowerCase();
    const where = s.where.toLowerCase();
    const keys = (s.keywords ?? "").toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title.startsWith(w)) score += 4;
      else if (title.includes(w)) score += 3;
      else if (where.includes(w)) score += 2;
      else if (keys.includes(w)) score += 1;
      else return { s, score: 0 };
    }
    return { s, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}
