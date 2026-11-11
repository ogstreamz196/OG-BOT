// Records which AI key failed (name + HTTP status only) so the background
// worker can send Boss a quiet Telegram heads-up. Never throws or blocks.
import { adminClient } from "./clients.ts";
import { envKey } from "./key-names.ts";

const KEY_NAMES = [
  "PAID_GEMINI_F196", "FREE_GEMINI_API_KEY_1", "FREE_GEMINI_API_KEY_2", "FREE_GEMINI_API_KEY_3",
  "FREE_GEMINI_API_KEY_4", "FREE_GROQ_API_KEY", "FREE_GROQ_API_KEY_2", "FREE_POLLINATIONS_API_KEY",
  "FREE_POLLINATIONS_API_KEY_2", "FREE_OPENROUTER_API_KEY", "FREE_OPENROUTER_API_KEY_2", "SUNO_API_KEY",
];
const ALERT_STATUSES = new Set([400, 401, 402, 403, 429]);

function keyFor(url: string, headers: Headers): string | null {
  const hay = `${url} ${headers.get("Authorization") ?? ""} ${headers.get("x-goog-api-key") ?? ""}`;
  for (const name of KEY_NAMES) {
    const v = envKey(name);
    if (v && v.length > 8 && hay.includes(v)) return name;
  }
  return null;
}

/** Wrap global fetch once per function so every key failure gets recorded. */
export function watchKeyFailures() {
  const g = globalThis as { __ogKeyWatch?: boolean };
  if (g.__ogKeyWatch) return;
  g.__ogKeyWatch = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if (ALERT_STATUSES.has(res.status)) {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const name = keyFor(url, new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
        if (name) {
          const p = adminClient().from("ai_key_failures").insert({ key_name: name, status: res.status }).then(() => {}, () => {});
          // @ts-expect-error EdgeRuntime exists in the edge runtime
          if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
        }
      } catch { /* never block */ }
    }
    return res;
  };
}
