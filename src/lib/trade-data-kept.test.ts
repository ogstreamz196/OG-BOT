// The Boss's rule: stored trade and learning data is never deleted. A purge
// clears the Telegram chat and the counters only. This fails if any code
// deletes from the tables the signals learn from.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const KEPT = ["trade_signals", "signal_learn_samples", "signal_shadows"];
/** Files whose own TABLE constant is one of the kept tables. */
const KEPT_TABLE_FILES = ["signal-samples.server.ts", "signal-shadows.server.ts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("trade and learning data is never deleted", () => {
  it("no code deletes from the tables the signals learn from", () => {
    const bad: string[] = [];
    for (const p of files("src")) {
      const s = readFileSync(p, "utf8");
      for (const t of KEPT) {
        const re = new RegExp(`from\\(\\s*["'\`]${t}["'\`]\\s*\\)[\\s\\S]{0,80}?\\.delete\\(`);
        if (re.test(s)) bad.push(`${p}: ${t}`);
      }
      if (
        KEPT_TABLE_FILES.some((f) => p.endsWith(f)) &&
        /from\(\s*TABLE\s*\)[\s\S]{0,80}?\.delete\(/.test(s)
      )
        bad.push(`${p}: TABLE`);
    }
    expect(bad).toEqual([]);
  });

  it("migrations never delete or truncate them", () => {
    const bad: string[] = [];
    for (const f of readdirSync("supabase/migrations")) {
      const s = readFileSync(join("supabase/migrations", f), "utf8").toLowerCase();
      for (const t of KEPT)
        if (new RegExp(`(delete\\s+from|truncate(\\s+table)?)\\s+(public\\.)?${t}\\b`).test(s))
          bad.push(`${f}: ${t}`);
    }
    expect(bad).toEqual([]);
  });
});
