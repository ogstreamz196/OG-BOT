// Football facts for OG Bot, worked out in code from ESPN's public scoreboard
// and standings feeds: results, fixtures, table, form and a simple lean for
// the next game. The model only presents these numbers, like trade signals.

export type League = { code: string; name: string };

export const LEAGUES: Record<string, League> = {
  "eng.1": { code: "eng.1", name: "Premier League" },
  "eng.2": { code: "eng.2", name: "Championship" },
  "esp.1": { code: "esp.1", name: "La Liga" },
  "ita.1": { code: "ita.1", name: "Serie A" },
  "ger.1": { code: "ger.1", name: "Bundesliga" },
  "fra.1": { code: "fra.1", name: "Ligue 1" },
  "sco.1": { code: "sco.1", name: "Scottish Premiership" },
  "uefa.champions": { code: "uefa.champions", name: "Champions League" },
};

const LEAGUE_WORDS: [RegExp, string][] = [
  [/\b(premier league|prem|epl)\b/i, "eng.1"],
  [/\b(championship|efl)\b/i, "eng.2"],
  [/\b(la ?liga|spanish league)\b/i, "esp.1"],
  [/\b(serie a|italian league)\b/i, "ita.1"],
  [/\b(bundesliga|german league)\b/i, "ger.1"],
  [/\b(ligue 1|french league)\b/i, "fra.1"],
  [/\b(spl|scottish prem(iership)?)\b/i, "sco.1"],
  [/\b(champions league|ucl)\b/i, "uefa.champions"],
];

/**
 * Clubs: clear names (always count), loose nicknames that only count inside a
 * football chat, the name ESPN uses, and the league to look in first.
 */
const TEAMS: [RegExp, RegExp | null, string, string][] = [
  [/\b(arsenal|gooners)\b/i, /\bgunners\b/i, "Arsenal", "eng.1"],
  [/\baston villa\b/i, /\bvilla\b/i, "Aston Villa", "eng.1"],
  [/\bbournemouth\b/i, /\bcherries\b/i, "Bournemouth", "eng.1"],
  [/\bbrentford\b/i, /\bbees\b/i, "Brentford", "eng.1"],
  [/\bbrighton\b/i, /\bseagulls\b/i, "Brighton", "eng.1"],
  [/\bburnley\b/i, /\bclarets\b/i, "Burnley", "eng.1"],
  [/\bchelsea\b/i, null, "Chelsea", "eng.1"],
  [/\bcrystal palace\b/i, /\bpalace\b/i, "Crystal Palace", "eng.1"],
  [/\beverton\b/i, /\btoffees\b/i, "Everton", "eng.1"],
  [/\bfulham\b/i, null, "Fulham", "eng.1"],
  [/\bleeds\b/i, null, "Leeds", "eng.1"],
  [/\b(liverpool|lfc)\b/i, null, "Liverpool", "eng.1"],
  [/\b(man(chester)? city|mcfc)\b/i, /\bcity\b/i, "Manchester City", "eng.1"],
  [/\b(man(chester)? (utd|united)|mufc)\b/i, /\b(united|utd)\b/i, "Manchester United", "eng.1"],
  [/\bnewcastle\b/i, /\b(toon|magpies)\b/i, "Newcastle", "eng.1"],
  [/\bnott(ingha)?m forest\b/i, /\bforest\b/i, "Nottingham Forest", "eng.1"],
  [/\bsunderland\b/i, null, "Sunderland", "eng.1"],
  [/\b(spurs|tottenham)\b/i, null, "Tottenham", "eng.1"],
  [/\bwest ham\b/i, /\bhammers\b/i, "West Ham", "eng.1"],
  [/\b(wolves|wolverhampton)\b/i, null, "Wolverhampton", "eng.1"],
  [/\bleicester\b/i, /\bfoxes\b/i, "Leicester", "eng.2"],
  [/\bsouthampton\b/i, /\bsaints\b/i, "Southampton", "eng.2"],
  [/\bipswich\b/i, null, "Ipswich", "eng.2"],
  [/\bsheffield (utd|united)\b/i, /\bblades\b/i, "Sheffield United", "eng.2"],
  [/\bsheffield wednesday\b/i, /\bowls\b/i, "Sheffield Wednesday", "eng.2"],
  [/\bmiddlesbrough\b/i, /\bboro\b/i, "Middlesbrough", "eng.2"],
  [/\bnorwich\b/i, null, "Norwich", "eng.2"],
  [/\bwest brom\b/i, /\bbaggies\b/i, "West Bromwich", "eng.2"],
  [/\bstoke\b/i, null, "Stoke", "eng.2"],
  [/\bwatford\b/i, null, "Watford", "eng.2"],
  [/\bbirmingham\b/i, null, "Birmingham", "eng.2"],
  [/\bmillwall\b/i, null, "Millwall", "eng.2"],
  [/\b(qpr|queens park rangers)\b/i, null, "Queens Park Rangers", "eng.2"],
  [/\bderby county\b/i, /\bderby\b/i, "Derby", "eng.2"],
  [/\bcoventry\b/i, null, "Coventry", "eng.2"],
  [/\breal madrid\b/i, /\bmadrid\b/i, "Real Madrid", "esp.1"],
  [/\b(barcelona|barca)\b/i, null, "Barcelona", "esp.1"],
  [/\batletico\b/i, null, "Atl", "esp.1"],
  [/\b(juventus|juve)\b/i, null, "Juventus", "ita.1"],
  [/\binter milan\b/i, /\binter\b/i, "Internazionale", "ita.1"],
  [/\bac milan\b/i, /\bmilan\b/i, "AC Milan", "ita.1"],
  [/\bnapoli\b/i, null, "Napoli", "ita.1"],
  [/\bbayern\b/i, null, "Bayern", "ger.1"],
  [/\b(dortmund|bvb)\b/i, null, "Dortmund", "ger.1"],
  [/\b(psg|paris saint|paris sg)\b/i, null, "Paris Saint-Germain", "fra.1"],
  [/\bceltic\b/i, null, "Celtic", "sco.1"],
  [/\bglasgow rangers\b/i, /\brangers\b/i, "Rangers", "sco.1"],
];

const FOOTBALL_WORDS =
  /\b(football|footy|soccer|score|scores|scored|result|results|fixture|fixtures|table|league|top of|bottom of|relegat|promot|title race|won|win|beat|lost|lose|draw|drew|match|game|play(s|ing)? next|next game|kick[- ]?off|predict|prediction|form|goals?|top four|top 4|clean sheet)\b/i;

export type FootballAsk = { leagues: string[]; teams: { name: string; league: string }[] };

/** Is this a football question we can answer from data? null when it isn't. */
export function detectFootball(text: string | null | undefined): FootballAsk | null {
  if (!text) return null;
  const leagues = LEAGUE_WORDS.filter(([re]) => re.test(text)).map(([, code]) => code);
  const footbally = FOOTBALL_WORDS.test(text) || leagues.length > 0;
  const strong = TEAMS.filter(([re]) => re.test(text));
  const loose = footbally ? TEAMS.filter(([re, weak]) => !re.test(text) && !!weak?.test(text)) : [];
  // "Man City" shouldn't also count as some other "city".
  const picked = [
    ...strong,
    ...loose.filter(([, , name]) => !strong.some(([, , s]) => s === name)),
  ];
  if (!leagues.length && !picked.length) return null;
  // A club name alone ("arsenal are shite") still counts; a league needs nothing more.
  if (!footbally && !strong.length) return null;
  const teams = picked.slice(0, 2).map(([, , name, league]) => ({ name, league }));
  return {
    leagues: [...new Set([...leagues, ...teams.map((t) => t.league)])].slice(0, 2),
    teams,
  };
}

export type Match = {
  date: string;
  state: "pre" | "in" | "post";
  detail: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
};

type EspnCompetitor = {
  homeAway?: string;
  score?: string | { value?: number };
  team?: { displayName?: string; shortDisplayName?: string };
};
type EspnEvent = {
  date?: string;
  status?: { type?: { state?: string; shortDetail?: string; detail?: string } };
  competitions?: { competitors?: EspnCompetitor[] }[];
};

const score = (s: EspnCompetitor["score"]): number | null => {
  const v = typeof s === "object" ? s?.value : s;
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};

/** ESPN scoreboard JSON → matches. */
export function parseScoreboard(json: unknown): Match[] {
  const events = ((json as { events?: EspnEvent[] })?.events ?? []) as EspnEvent[];
  const out: Match[] = [];
  for (const e of events) {
    const comps = e.competitions?.[0]?.competitors ?? [];
    const home = comps.find((c) => c.homeAway === "home");
    const away = comps.find((c) => c.homeAway === "away");
    if (!home?.team || !away?.team || !e.date) continue;
    const state = e.status?.type?.state;
    out.push({
      date: e.date,
      state: state === "post" || state === "in" ? state : "pre",
      detail: e.status?.type?.shortDetail ?? e.status?.type?.detail ?? "",
      home: home.team.displayName ?? home.team.shortDisplayName ?? "Home",
      away: away.team.displayName ?? away.team.shortDisplayName ?? "Away",
      homeScore: state === "pre" ? null : score(home.score),
      awayScore: state === "pre" ? null : score(away.score),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type TableRow = {
  rank: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gd: number;
  points: number;
};

/** ESPN standings JSON → table rows, top first. */
export function parseStandings(json: unknown): TableRow[] {
  type Entry = {
    team?: { displayName?: string };
    stats?: { name?: string; type?: string; value?: number }[];
  };
  const root = json as {
    children?: { standings?: { entries?: Entry[] } }[];
    standings?: { entries?: Entry[] };
  };
  const entries = root?.children?.[0]?.standings?.entries ?? root?.standings?.entries ?? [];
  const rows = entries.map((e) => {
    const stat = (...names: string[]) => {
      const s = (e.stats ?? []).find(
        (x) => names.includes(x.name ?? "") || names.includes(x.type ?? ""),
      );
      return Number(s?.value ?? 0);
    };
    return {
      rank: stat("rank"),
      team: e.team?.displayName ?? "?",
      played: stat("gamesPlayed"),
      won: stat("wins"),
      drawn: stat("ties", "draws"),
      lost: stat("losses"),
      gd: stat("pointDifferential", "goalDifference"),
      points: stat("points"),
    };
  });
  return rows
    .filter((r) => r.team !== "?")
    .sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.points - a.points);
}

export const teamMatches = (name: string, team: string) =>
  team.toLowerCase().includes(name.toLowerCase());

/** 1 → "1st", 22 → "22nd". */
export function ordinal(n: number): string {
  const teen = Math.floor(n / 10) % 10 === 1;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Last results for a team, newest last, as W/D/L. */
export function form(matches: Match[], team: string, n = 5): string {
  return matches
    .filter((m) => m.state === "post" && (teamMatches(team, m.home) || teamMatches(team, m.away)))
    .slice(-n)
    .map((m) => {
      const mine = teamMatches(team, m.home) ? m.homeScore! : m.awayScore!;
      const theirs = teamMatches(team, m.home) ? m.awayScore! : m.homeScore!;
      return mine > theirs ? "W" : mine < theirs ? "L" : "D";
    })
    .join("");
}

/**
 * A simple lean for a fixture from points per game, goal difference per game
 * and home advantage. It's a read of the numbers, never a promise.
 */
export function lean(
  table: TableRow[],
  home: string,
  away: string,
): { pick: string; strength: "slight" | "clear" | "strong" } | null {
  const h = table.find((r) => teamMatches(home, r.team) || teamMatches(r.team, home));
  const a = table.find((r) => teamMatches(away, r.team) || teamMatches(r.team, away));
  if (!h || !a || !h.played || !a.played) return null;
  const rating = (r: TableRow) => r.points / r.played + (0.25 * r.gd) / r.played;
  const diff = rating(h) + 0.3 - rating(a);
  if (Math.abs(diff) < 0.25) return { pick: "Draw or either way", strength: "slight" };
  const pick = diff > 0 ? `${h.team} to win` : `${a.team} to win`;
  const size = Math.abs(diff);
  return { pick, strength: size > 0.9 ? "strong" : size > 0.5 ? "clear" : "slight" };
}

const ukDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function matchLine(m: Match): string {
  if (m.state === "pre") return `${ukDate(m.date)} UK: ${m.home} v ${m.away}`;
  const sc = `${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`;
  return m.state === "in"
    ? `LIVE ${m.detail}: ${sc}`
    : `${ukDate(m.date).replace(/, \d\d:\d\d$/, "")}: ${sc} (FT)`;
}

export const FOOTBALL_RULES = `FOOTBALL DATA MODE: the block below is live data from the football feeds, worked out in code.
- Use ONLY these scores, dates, table positions, points and form. Copy them exactly; never invent a score, scorer, date or stat that isn't here.
- Answer exactly as you normally would, same OG Bot voice, slang and attitude (roast the losing side, wind up the fan). Only the facts are pinned down.
- A "lean" is a read of the numbers, not a sure thing. Say so in a few words if you mention it, and never tell anyone to bet.
- If something they asked isn't in the data (scorers, injuries, transfers), say you haven't got that bit rather than guessing.`;
