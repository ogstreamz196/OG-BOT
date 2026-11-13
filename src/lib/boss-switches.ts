/**
 * Every on/off switch the Boss has, in plain words: what it does when it's on,
 * what happens when it's off, and where it lives. Shown on the Boss dashboard
 * ("Every switch") so nothing has to be hunted for. Each one was traced to the
 * code that obeys it (2026-11-13); boss-switches.test.ts checks every link
 * still lands on a real tab.
 *
 * Pure data, browser-safe. When you add a switch anywhere in the Boss console
 * or the bots, add a line here too.
 */

export type SwitchArea =
  "Everyone" | "Trading" | "Telegram" | "Members" | "Money" | "Services" | "You";

export type BossSwitch = {
  name: string;
  /** What it does when it's on. */
  on: string;
  /** What happens when it's off. */
  off: string;
  area: SwitchArea;
  /** Where it lives, as the Boss would say it. */
  where: string;
  /** A Boss page (and tab) that has it. */
  to?:
    "/admin" | "/admin/users" | "/admin/coins" | "/admin/signals" | "/admin/system" | "/settings";
  tab?: string;
  /** A Settings section (#id) when it lives on Settings. */
  hash?: string;
  /** Set only in a Telegram bot, not on the website. */
  telegramOnly?: boolean;
};

export const BOSS_SWITCHES: readonly BossSwitch[] = [
  // Everyone
  {
    name: "Free VIP for all",
    on: "Every signed-in member gets VIP features (songs, foul mouth, VIP chat), until the end time if you set one.",
    off: "Only real VIPs, trials and admins get VIP features.",
    area: "Everyone",
    where: "Dashboard bar (full version with a custom end time: System › Free access)",
    to: "/admin/system",
    tab: "access",
  },
  {
    name: "OG Signals portal",
    on: "The signals board on the website is open to members.",
    off: "The website's signals board is closed. Telegram signals carry on.",
    area: "Everyone",
    where: "Dashboard bar and Signals › Controls",
    to: "/admin/signals",
    tab: "controls",
  },

  // Trading
  {
    name: "MT5 auto-trade",
    on: "Signals at 70% or more are placed on your MT5 account automatically.",
    off: "Nothing is placed on MT5 by the website. Signals still post.",
    area: "Trading",
    where: "Signals › Controls",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "Pause copying",
    on: "Copiers take no new trades. Open trades are still managed and closed.",
    off: "Copiers copy every signal the signals bot posts.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "High-frequency (HFT)",
    on: "Faster checks, at least 10 trades running, no cap, lots at the top of your range (gold only above $400 balance).",
    off: "Normal pace, up to your trade limit, lot by signal strength.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "Sniper entries",
    on: "Entries wait at the last gap or retest (limit orders) instead of the price now.",
    off: "The engine picks pullback, break or price now as usual.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "Hedges",
    on: "When the open trades on a market all lean one way, it looks for a reversal trade on the other side.",
    off: "No hedge trades are posted.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "Range hedge",
    on: "In a sideways market, a buy near the floor and a sell near the ceiling.",
    off: "No range trades are posted.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "Patterns alongside",
    on: "Setups the learning has proven post beside the main engine's trades, not only when it says wait.",
    off: "Only the main signals post.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "Gold / Bitcoin (copier markets)",
    on: "The copier copies that market.",
    off: "That market is skipped by the copier.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },
  {
    name: "Broker stop",
    on: "Copied trades carry a stop loss at the broker as a safety net.",
    off: "No stop on the broker; the copier closes trades itself at its levels.",
    area: "Trading",
    where: "Signals › Controls › Trading switches (also on the Copy Trader B0T card)",
    to: "/admin/signals",
    tab: "controls",
  },

  // Telegram
  {
    name: "Worker bot on/off",
    on: "That bot answers in private chats and taps.",
    off: "That bot ignores every message.",
    area: "Telegram",
    where: "Signals › Bots › Worker fleet",
    to: "/admin/signals",
    tab: "bots",
  },
  {
    name: "Bot allowed in a group",
    on: "That bot (or the trade bot) answers in that group.",
    off: "It stays quiet in that group.",
    area: "Telegram",
    where: "Signals › Bots › Telegram groups",
    to: "/admin/signals",
    tab: "bots",
  },
  {
    name: "New signup alert",
    on: "OG B0T messages you on Telegram when someone joins.",
    off: "No message for new signups.",
    area: "Telegram",
    where: "System › OG B0T › Your alerts",
    to: "/admin/system",
    tab: "bot",
  },
  {
    name: "Every sign-in alert",
    on: "OG B0T messages you every time a member signs in.",
    off: "No message for ordinary sign-ins.",
    area: "Telegram",
    where: "System › OG B0T › Your alerts",
    to: "/admin/system",
    tab: "bot",
  },

  // Members
  {
    name: "VIP (one member)",
    on: "That member gets VIP, until the end date you choose.",
    off: "Their VIP is taken away.",
    area: "Members",
    where: "Members › open the member",
    to: "/admin/users",
  },
  {
    name: "OG Vault access (one member)",
    on: "That member gets a free OG Vault pass, separate from VIP.",
    off: "Their Vault pass is taken away.",
    area: "Members",
    where: "Members › open the member",
    to: "/admin/users",
  },

  // Money
  {
    name: "Store item for sale",
    on: "The item shows in the OG Store and can be bought.",
    off: "The item is hidden from the store.",
    area: "Money",
    where: "Money › Prices & store › Store",
    to: "/admin/coins",
    tab: "prices",
  },

  // Services
  {
    name: "Extra AI key",
    on: "OG B0T can use that key alongside the built-in free keys.",
    off: "That key is never used.",
    area: "Services",
    where: "System › Health › API keys › API vault",
    to: "/admin/system",
    tab: "health",
  },
  {
    name: "Ledgerly",
    on: "Each card sale is sent to your Ledgerly accounts.",
    off: "Nothing is sent to Ledgerly.",
    area: "Services",
    where: "System › Health › API keys › Payments",
    to: "/admin/system",
    tab: "health",
  },
  {
    name: "Vault pass login active",
    on: "That Vault pass login works in OG VAULT.",
    off: "That login is switched off in OG VAULT.",
    area: "Services",
    where: "System › Health › API keys › OG Vault webhook",
    to: "/admin/system",
    tab: "health",
  },

  // You (your own account, like any member)
  {
    name: "OG B0T foul mouth",
    on: "OG B0T swears at you in chat (VIP only).",
    off: "OG B0T keeps it clean with you.",
    area: "You",
    where: "Settings › Preferences",
    to: "/settings",
    hash: "preferences",
  },
  {
    name: "OG B0T memory",
    on: "OG B0T remembers things you tell it, to use in later chats.",
    off: "Nothing is remembered, and what it had is wiped.",
    area: "You",
    where: "Settings › Preferences",
    to: "/settings",
    hash: "preferences",
  },
];

export const SWITCH_AREAS: readonly SwitchArea[] = [
  "Everyone",
  "Trading",
  "Telegram",
  "Members",
  "Money",
  "Services",
  "You",
];
