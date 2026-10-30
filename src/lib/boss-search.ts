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
  | "/admin/bot"
  | "/admin/system"
  | "/settings";

export type BossSetting = {
  title: string;
  /** Where it lives, e.g. "OG B0T › Signals". */
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
    where: area("Money", "Prices & limits"),
    to: "/admin/coins",
    tab: "prices",
    keywords: "cost charge pricing song price limits",
  },
  {
    title: "OG Store",
    where: area("Money", "Store"),
    to: "/admin/coins",
    tab: "store",
    keywords: "shop items stock categories products",
  },
  {
    title: "Card payments",
    where: area("Money", "Card payments"),
    to: "/admin/coins",
    tab: "card",
    keywords: "stripe refunds accountant purchases",
  },
  {
    title: "Stripe payments webhook",
    where: area("Money", "Stripe events"),
    to: "/admin/coins",
    tab: "webhooks",
    keywords: "payments webhook stripe events credited",
  },
  {
    title: "Coin check",
    where: area("Money", "Coin check"),
    to: "/admin/coins",
    tab: "coin-check",
    keywords: "audit mismatch balance history reconcile",
  },
  {
    title: "Referrals",
    where: area("Money", "Referrals"),
    to: "/admin/coins",
    tab: "referrals",
    keywords: "invite codes leaders",
  },

  // OG B0T
  {
    title: "OG B0T persona",
    where: area("OG B0T", "Persona"),
    to: "/admin/bot",
    tab: "persona",
    keywords: "script system prompt voice dictionary how it talks",
  },
  {
    title: "Telegram worker bots",
    where: area("OG B0T", "Telegram"),
    to: "/admin/bot",
    tab: "telegram",
    keywords: "fleet workers bot tokens on off switch webhook",
  },
  {
    title: "Telegram groups",
    where: area("OG B0T", "Telegram"),
    to: "/admin/bot",
    tab: "telegram",
    keywords: "group chats worker switches",
  },
  {
    title: "Your Telegram alerts",
    where: area("OG B0T", "Your alerts"),
    to: "/admin/bot",
    tab: "alerts",
    keywords: "notifications notify events switches",
  },
  {
    title: "Signals portal on/off",
    where: area("OG B0T", "Signals"),
    to: "/admin/bot",
    tab: "signals",
    keywords: "trade signals switch btc gold xau",
  },
  {
    title: "MT5 auto-trade",
    where: area("OG B0T", "Signals"),
    to: "/admin/bot",
    tab: "signals",
    keywords: "metatrader mt5 auto trade switch",
  },
  {
    title: "Signal record & backtest",
    where: area("OG B0T", "Signals"),
    to: "/admin/bot",
    tab: "signals",
    keywords: "wins losses results history test past prices",
  },
  {
    title: "Live users",
    where: area("OG B0T", "Live users"),
    to: "/admin/bot",
    tab: "live",
    keywords: "online now speak as og bot",
  },
  {
    title: "Bot health & AI usage",
    where: area("OG B0T", "Health & usage"),
    to: "/admin/bot",
    tab: "health",
    keywords: "ping gemini cost answering",
  },

  // System
  {
    title: "Free access for everyone",
    where: area("System", "Free access"),
    to: "/admin/system",
    tab: "access",
    keywords: "vip for all switch promo open",
  },
  {
    title: "API keys",
    where: area("System", "API keys"),
    to: "/admin/system",
    tab: "apis",
    keywords: "services connectors ping secrets",
  },
  {
    title: "Ledgerly",
    where: area("System", "API keys › Payments"),
    to: "/admin/system",
    tab: "apis",
    keywords: "accounts bookkeeping switch",
  },
  {
    title: "OG Vault webhook",
    where: area("System", "API keys › Payments"),
    to: "/admin/system",
    tab: "apis",
    keywords: "vault pass sync switch",
  },
  {
    title: "Setup checklist",
    where: area("System", "Setup checklist"),
    to: "/admin/system",
    tab: "setup",
    keywords: "onboarding connectors secrets",
  },
  {
    title: "Diagnostics",
    where: area("System", "Diagnostics"),
    to: "/admin/system",
    tab: "tests",
    keywords: "smoke test check telegram foul mouth",
  },
  {
    title: "Boss actions log",
    where: area("System", "Boss actions"),
    to: "/admin/system",
    tab: "actions",
    keywords: "audit history who did what",
  },
  {
    title: "More tools",
    where: area("System", "More tools"),
    to: "/admin/system",
    tab: "tools",
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
