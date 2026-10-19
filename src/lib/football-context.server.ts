// Builds OG Bot's FOOTBALL DATA block from ESPN's public feeds (no key).
// Everything soft-fails: no data means no block, and OG Bot falls back to the
// live web search.
import {
  FOOTBALL_RULES,
  LEAGUES,
  detectFootball,
  form,
  lean,
  matchLine,
  ordinal,
  parseScoreboard,
  parseStandings,
  teamMatches,
  type Match,
  type TableRow,
} from "./football";

const BASE = "https://site.api.espn.com/apis";
const TIMEOUT_MS = 3000;
const TTL_MS = { live: 60_000, table: 10 * 60_000 };
const cache = new Map<string, { exp: number; value: unknown }>();

async function getJson(url: string, ttl: number): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && hit.exp > Date.now()) return hit.value;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const value = await res.json();
    cache.set(url, { exp: Date.now() + ttl, value });
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    return value;
  } catch {
    return null;
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function leagueData(code: string): Promise<{ matches: Match[]; table: TableRow[] }> {
  const now = Date.now();
  const from = ymd(new Date(now - 42 * 86_400_000));
  const to = ymd(new Date(now + 21 * 86_400_000));
  const [board, standings] = await Promise.all([
    getJson(
      `${BASE}/site/v2/sports/soccer/${code}/scoreboard?dates=${from}-${to}&limit=500`,
      TTL_MS.live,
    ),
    getJson(`${BASE}/v2/sports/soccer/${code}/standings`, TTL_MS.table),
  ]);
  return { matches: parseScoreboard(board), table: parseStandings(standings) };
}

function teamLines(
  name: string,
  matches: Match[],
  table: TableRow[],
  leagueName: string,
): string[] {
  const mine = matches.filter((m) => teamMatches(name, m.home) || teamMatches(name, m.away));
  if (!mine.length) return [];
  const label =
    (mine[0] && (teamMatches(name, mine[0].home) ? mine[0].home : mine[0].away)) || name;
  const live = mine.filter((m) => m.state === "in");
  const done = mine.filter((m) => m.state === "post").slice(-5);
  const next = mine.find((m) => m.state === "pre");
  const row = table.find((r) => teamMatches(name, r.team));
  const out = [`${label.toUpperCase()} (${leagueName})`];
  if (row)
    out.push(
      `Table: ${ordinal(row.rank)} on ${row.points} pts from ${row.played} games (W${row.won} D${row.drawn} L${row.lost}, GD ${row.gd > 0 ? "+" : ""}${row.gd})`,
    );
  const f = form(matches, name);
  if (f) out.push(`Form (oldest to newest): ${f}`);
  for (const m of live) out.push(matchLine(m));
  if (done.length) out.push("Recent results:", ...done.map((m) => `  ${matchLine(m)}`));
  if (next) {
    out.push(`Next game: ${matchLine(next)}`);
    const l = lean(table, next.home, next.away);
    if (l) out.push(`Lean from the numbers: ${l.pick} (${l.strength} edge; a read, not a promise)`);
  }
  return out;
}

/** The FOOTBALL DATA block for a message, or "" when it isn't about football. */
export async function buildFootballContext(userText: string): Promise<string> {
  const ask = detectFootball(userText);
  if (!ask) return "";
  const codes = ask.leagues.length ? ask.leagues : ["eng.1"];
  const data = new Map(
    await Promise.all(codes.map(async (c) => [c, await leagueData(c)] as const)),
  );
  const sections: string[] = [];

  for (const team of ask.teams) {
    let lines = teamLines(
      team.name,
      data.get(team.league)?.matches ?? [],
      data.get(team.league)?.table ?? [],
      LEAGUES[team.league].name,
    );
    // Promoted or relegated since the list was written: try the other English tier.
    if (!lines.length && team.league.startsWith("eng.")) {
      const other = team.league === "eng.1" ? "eng.2" : "eng.1";
      const d = data.get(other) ?? (await leagueData(other));
      lines = teamLines(team.name, d.matches, d.table, LEAGUES[other].name);
    }
    if (lines.length) sections.push(lines.join("\n"));
  }

  // A league question without a team (or the team's league too): table and the latest round.
  if (!ask.teams.length) {
    for (const code of codes) {
      const d = data.get(code);
      if (!d) continue;
      const lines = [`${LEAGUES[code].name.toUpperCase()}`];
      if (d.table.length)
        lines.push(
          "Table:",
          ...d.table.map(
            (r) =>
              `  ${r.rank}. ${r.team} ${r.points} pts (P${r.played}, GD ${r.gd > 0 ? "+" : ""}${r.gd})`,
          ),
        );
      const live = d.matches.filter((m) => m.state === "in");
      const recent = d.matches.filter((m) => m.state === "post").slice(-10);
      const upcoming = d.matches.filter((m) => m.state === "pre").slice(0, 10);
      if (live.length) lines.push("Live now:", ...live.map((m) => `  ${matchLine(m)}`));
      if (recent.length) lines.push("Latest results:", ...recent.map((m) => `  ${matchLine(m)}`));
      if (upcoming.length) lines.push("Coming up:", ...upcoming.map((m) => `  ${matchLine(m)}`));
      if (lines.length > 1) sections.push(lines.join("\n"));
    }
  }

  if (!sections.length) return "";
  return `${FOOTBALL_RULES}\n\nFOOTBALL DATA (ESPN, as of ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC):\n${sections.join("\n\n")}`;
}
