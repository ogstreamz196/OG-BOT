/**
 * TV and app help is always answered clean (the Boss's rule): no swearing,
 * insults or roasting, whatever the member's foul mouth switch says. Someone
 * asking how to set up a Firestick, OG Vault or an app wants clear steps.
 *
 * Pure text checks, no AI. Used by the website chat (og-chat.server.ts), the
 * Telegram webhook, and as a safety net for every chat reply in
 * ai-endpoint.server.ts (cleanForTvHelp).
 */

/** TV devices: asking about one is TV help on its own. */
const DEVICE =
  /\b(fire ?sticks?|fire ?tv|firetv|android ?tv|google ?tv|smart ?tvs?|tv ?box(es)?|nvidia ?shield|mi ?box|chromecast|roku|formuler|mag ?box|onn ?box)\b/i;

/** TV apps and services: the same. */
const SERVICE =
  /\b(iptv|m3u|xtream|epg|tivimate|smarters|ibo ?player|downloader|kodi|apks?|sideload\w*|og ?vault|vault ?pass|app ?store)\b/i;

/** Asking for help or reporting a problem. */
const HELP =
  /\b(how (do|can|to|should|does)|help|set ?up|setup|install\w*|download\w*|log ?in|login|sign ?in|not (working|loading|playing|opening)|won'?t (work|load|play|open)|doesn'?t (work|load|open|play)|isn'?t working|stopped working|keeps? (crashing|freezing|buffering|stopping)|buffer\w*|freez\w*|crash\w*|error|reinstall|update|guide|steps?)\b/i;

/** A TV or app word, for help asks that don't name a device. */
const TV_OR_APP = /\b(tv|telly|apps?|channels?|remote|box)\b/i;

/** One message asking for TV or app help. */
export function isTvHelp(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (!t.trim()) return false;
  return DEVICE.test(t) || SERVICE.test(t) || (HELP.test(t) && TV_OR_APP.test(t));
}

/**
 * The latest message asks for TV or app help, or follows up on one ("still
 * not working") right after a TV help ask. Oldest first.
 */
export function isTvHelpChat(userTexts: (string | null | undefined)[]): boolean {
  const latest = userTexts.at(-1);
  if (isTvHelp(latest)) return true;
  const before = userTexts.at(-2);
  return !!latest && HELP.test(latest) && isTvHelp(before);
}

/** Added to the system prompt when the chat is TV or app help. */
export const CLEAN_TV_HELP_NOTE =
  "CLEAN ANSWER (house rule, overrides the persona above): this member is asking for help with TV or app setup. " +
  "No swearing, no insults, no roasting, no crude jokes, not even mild ones. " +
  "Stay warm and friendly as OG B0T and give clear, simple steps (numbered when there's more than one).";
