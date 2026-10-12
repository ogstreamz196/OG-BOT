// Gives OG Bot read access to the Sports Guide feed when a user asks about
// fixtures, fights, kick-off times or which TV channel is showing an event.
import { SPORT_CATEGORIES } from "./sports-guide-parse";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
type Admin = SupabaseClient<Database>;

const SPORTS_INTENT_RE =
  /\b(sports?|fixtures?|match(es)?|games?|kick[\s-]?off|ko|fight(s|ing)?|fight night|card|bout|race|grand prix|f1|ufc|boxing|mma|wwe|darts|tennis|cricket|nba|nfl|football|soccer|premier league|champions league|ucl|epl|la ?liga|serie a|bundesliga|vs\.?|versus|play|plays|playing|next match|next game|against|on tonight|on today|on tv|channel|channels|sky sports|tnt|dazn|bt sport|amazon prime|what time|when is|where can i watch|watch)\b/i;

const STOP = new Set(
  "the a an and or of to in on at for is are was be what when where which who how time today tonight tomorrow game match fixture fixtures channel channels watch playing play sport sports show showing can i me my you u it its any there this that with vs versus kick off live tv on bro mate pls please".split(
    " ",
  ),
);

export function detectSportsIntent(text: string | null | undefined): boolean {
  return !!text && SPORTS_INTENT_RE.test(text);
}

function keywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  ).slice(0, 8);
}

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const SPORTS_LOCKED_PROMPT = `SPORTS GUIDE LOCKED — HARD RULE: This user has NOT unlocked the OG Sports Guide and is not VIP. Do NOT give ANY fixtures, kick-off times, dates, channels, broadcasters or Telegram links — not from the guide, not from memory, not from web sources. Do not mention or link any Telegram channel/group. Instead, in full OG Bot voice (cheeky British banter, roast them for being tight), tell them:
1. The OG Sports Guide is locked — unlock it in the Store for just 10 OG Coins, or go VIP and it's included free (VIP includes it during the 15-day free trial too).
2. No coins? Earn them with the app's earn methods (referrals/inviting mates via their OG code, Battle Zone rewards, the Earn page), or stop being tight and just buy some — 5 coins is only 99p at https://www.ogbot.co.uk/buy-coins.
3. Once unlocked, the full live match centre is at https://www.ogbot.co.uk/sports and you'll answer every fixture question.
Keep it short and punchy.`;

// Warm per-instance caches so repeat questions skip the DB parse / web search.
type Fixture = ReturnType<typeof import("./sports-listing").parseListing>["fixtures"][number];
let fixtureCache: { at: number; value: Fixture[] } | null = null;
let fixtureInflight: Promise<Fixture[]> | null = null;
const webCache = new Map<string, { value: string; exp: number }>();

async function loadFixturesCached(admin: Admin): Promise<Fixture[]> {
  if (fixtureCache && Date.now() - fixtureCache.at < 60_000) return fixtureCache.value;
  if (fixtureInflight) return fixtureInflight;
  fixtureInflight = (async () => {
    const { parseListing, dedupe } = await import("./sports-listing");
    const { data } = await admin
      .from("sports_guide_posts")
      .select("id, raw_text, posted_at, telegram_message_id")
      .gte("posted_at", new Date(Date.now() - 10 * 86_400_000).toISOString())
      .order("posted_at", { ascending: false })
      .limit(120);
    const fixtures = dedupe(data ?? []).map(parseListing).flatMap((l) => l.fixtures);
    const seen = new Set<string>();
    const uniq = fixtures.filter((f) => !seen.has(f.raw) && seen.add(f.raw));
    fixtureCache = { at: Date.now(), value: uniq };
    return uniq;
  })().finally(() => { fixtureInflight = null; });
  return fixtureInflight;
}

/** Returns a prompt block, or "" when the message isn't about sport.
 * Always checks the parsed feed for team/event names, so "when does Swansea
 * play next" works even without sporty words. */
export async function buildSportsGuideContext(admin: Admin, userId: string, text: string): Promise<string> {
  if (!text?.trim()) return "";
  const words = keywords(text);
  if (!detectSportsIntent(text) && !words.length) return "";

  const uniq = await loadFixturesCached(admin);

  const score = (f: (typeof uniq)[number]) => {
    const hay = `${f.event} ${f.channel}`.toLowerCase();
    return words.filter((w) => hay.includes(w)).length;
  };
  const hits = words.length
    ? uniq
        .filter((f) => score(f) > 0)
        .sort((a, b) => score(b) - score(a) || (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
    : [];

  // Not a sports question and nothing in the feed matches — stay out of the way.
  if (!detectSportsIntent(text) && !hits.length) return "";

  const { data: access } = await admin.rpc("has_sports_guide_access", { _user: userId });
  if (!access) return SPORTS_LOCKED_PROMPT;

  const now = fmtDay(new Date().toISOString());
  const cutoff = Date.now() - 3 * 3_600_000;
  const pool = hits.length
    ? hits
    : uniq.filter((f) => f.at && f.at.getTime() > cutoff).sort((a, b) => a.at!.getTime() - b.at!.getTime());
  const list = pool
    .slice(0, 40)
    .map((f) => `• ${f.at ? fmtDay(f.at.toISOString()) + " UK" : "time not listed"} — ${f.event} — 📺 ${f.channel}`);

  // Not in the guide? Check the web so OG Bot still knows about future events.
  let web: string | null = null;
  if (!hits.length && words.length) {
    const { getLiveResearchContext } = await import("./ai-endpoint.server");
    const q = `${text} next fixture date kick-off time UK TV channel`;
    const key = q.toLowerCase().replace(/\s+/g, " ").trim();
    const hit = webCache.get(key);
    if (hit && hit.exp > Date.now()) web = hit.value;
    else {
      // Cap the web lookup so a slow search never stalls the reply.
      web = await Promise.race([
        getLiveResearchContext(q).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 6000)),
      ]);
      if (web) webCache.set(key, { value: web, exp: Date.now() + 30 * 60_000 });
    }
  }
  const webBlock = web
    ? `\n\nWEB RESULTS (not in the Sports Guide — use these to answer; say it's not in the guide yet, give date, UK time and UK TV channel if found, and never invent anything not stated here):\n${web.slice(0, 4000)}`
    : "";

  if (!list.length) {
    return `SPORTS GUIDE (current UK time: ${now}): The Sports Guide feed has no matching events right now.${web ? "" : " Say so honestly, don't invent fixtures or channels, and point them to https://www.ogbot.co.uk/sports for the live list."}${webBlock}`;
  }

  return `SPORTS GUIDE FIXTURES (the user's unlocked OG Sports Guide — trusted, already searched for you). Current UK time: ${now}.
${hits.length ? "These fixtures MATCH the user's question. Answer from them straight away, first time, confidently. NEVER say you can't see it, and never send them to BBC, club sites or anywhere else." : "No exact match for their words; these are the next upcoming fixtures."}
Answer with: the event, day + date, UK kick-off time, how long until it starts, and EVERY channel listed for it as bullets. If they ask "next", give the soonest upcoming one first. Never invent fixtures. Plain text only, no markdown asterisks. Never mention any Telegram channel or t.me link. You may mention https://www.ogbot.co.uk/sports.

${list.join("\n")}${webBlock}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtKo = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

/** Instant Telegram reply for "/sports <query>" — same parser/search as the website. */
export async function quickSportsReply(admin: Admin, userId: string, query: string): Promise<string> {
  const { data: access } = await admin.rpc("has_sports_guide_access", { _user: userId });
  if (!access)
    return "🔒 Oi, nice try! The <b>OG Sports Guide</b> is locked, mate.\n\n🏆 Unlock it in the Store for just <b>10 OG Coins</b> — or go <b>VIP</b> and it's included free.\n\n💸 Skint? Earn coins by inviting your mates with your OG code or smashing Battle Zone. Or stop being tight and just buy some — <b>5 coins is only 99p</b>.\n\n👉 https://www.ogbot.co.uk/buy-coins";
  const { parseListing, dedupe, searchListing } = await import("./sports-listing");
  const { data } = await admin
    .from("sports_guide_posts")
    .select("id, raw_text, posted_at, telegram_message_id")
    .gte("posted_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("posted_at", { ascending: false })
    .limit(80);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const listings = dedupe(data ?? []).map(parseListing);
  const hits = listings.map((l) => searchListing(l, words)).filter((l): l is NonNullable<typeof l> => !!l);
  const fixtures = hits.flatMap((l) => l.fixtures);
  if (!words.length) {
    const upcoming = fixtures.filter((f) => f.at && f.at.getTime() > Date.now() - 2 * 3_600_000)
      .sort((a, b) => a.at!.getTime() - b.at!.getTime()).slice(0, 15);
    if (!upcoming.length) return "⚽ No upcoming fixtures in the guide right now.";
    return "⚽ <b>Next up</b>\n" + upcoming.map((f) => `• ${fmtKo(f.at!)} — ${esc(f.event)}\n   📺 ${esc(f.channel)}`).join("\n");
  }
  if (!fixtures.length) return `⚽ No fixtures found for "<b>${esc(query)}</b>".`;
  const seen = new Set<string>();
  const uniq = fixtures.filter((f) => !seen.has(f.raw) && seen.add(f.raw))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0)).slice(0, 20);
  return `⚽ <b>${uniq.length} match${uniq.length === 1 ? "" : "es"}</b> for "${esc(query)}"\n` +
    uniq.map((f) => `• ${f.at ? fmtKo(f.at) : ""} — ${esc(f.event)}\n   📺 ${esc(f.channel)}`).join("\n");
}
