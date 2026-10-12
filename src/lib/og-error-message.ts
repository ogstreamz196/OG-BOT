/**
 * Turn raw technical errors (HTTP codes, "non-2xx", fetch failures) into a
 * short OG-voice chat line. Never shows raw error text to users.
 */
export function ogErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const s = raw.toLowerCase();
  const code = Number(/\b([45]\d\d)\b/.exec(raw)?.[1] ?? 0);

  if (/failed to fetch|network|offline|load failed/.test(s))
    return "📡 Your signal's gone walkabout, fam. Check your internet and send it again.";
  if (code === 401 || /unauthori[sz]ed|jwt|session/.test(s))
    return "🔐 You've been logged out, bruv. Sign back in and I'm all yours.";
  if (code === 403 || /forbidden|not allowed|permission/.test(s))
    return "🚫 That's above your pay grade, mate — that bit's locked for your account.";
  if (code === 402 || /insufficient|not enough coins|balance/.test(s))
    return "🪙 You're skint on coins for that one. Top up in the Store or earn some in Battle Zone.";
  if (code === 429 || /rate limit|too many|busy/.test(s))
    return "🥵 I'm getting rinsed with messages right now. Give me a minute and try again.";
  if (code === 413 || /too large|too big/.test(s))
    return "🐘 That file's a proper chunky boy. Send something smaller (under ~6MB).";
  if (code === 400 || /invalid|unsupported/.test(s))
    return "🤨 I couldn't make sense of that one. Try rewording it or send a different file.";
  if (code === 504 || /timeout|timed out|out of time/.test(s))
    return "⏳ My brain took too long and timed out. Hit send again — I'll be quicker.";
  if (code >= 500 || /non-2xx|server|internal/.test(s))
    return "🛠️ My wires got crossed on the server side. Not your fault — try again in a sec.";
  return "😵 Something glitched on my end. Give it another go in a moment.";
}
