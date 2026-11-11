import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEY_ALIASES, envKey } from "./key-names";

describe("universal key names", () => {
  it("reads the new name first", () => {
    expect(envKey("FREE_GROQ_API_KEY", { FREE_GROQ_API_KEY: "new", GROQ_API_KEY: "old" })).toBe(
      "new",
    );
  });
  it("falls back to the old name, so nothing breaks before the secrets are renamed", () => {
    expect(envKey("FREE_GROQ_API_KEY_2", { GROQ_BACKUP_API_KEY: "old" })).toBe("old");
    expect(envKey("PAID_GEMINI_F196", { GEMINI_API_KEY: "paid" })).toBe("paid");
    expect(envKey("FREE_GEMINI_API_KEY_1", { GEMINI_FREE_API_KEY: "g1" })).toBe("g1");
  });
  it("treats blank as missing and reads other names as they are", () => {
    expect(envKey("FREE_OPENROUTER_API_KEY", { FREE_OPENROUTER_API_KEY: "  " })).toBeUndefined();
    expect(envKey("SUNO_API_KEY", { SUNO_API_KEY: "s" })).toBe("s");
  });
  it("names every free key FREE_ and the paid Gemini key PAID_GEMINI_F196", () => {
    for (const n of Object.keys(KEY_ALIASES))
      expect(n).toMatch(/^(FREE_[A-Z]+_API_KEY(_\d)?|PAID_GEMINI_F196)$/);
  });
  it("the edge functions' copy is identical", () => {
    const a = readFileSync("src/lib/key-names.ts", "utf8");
    const b = readFileSync("supabase/functions/_shared/key-names.ts", "utf8");
    expect(b).toBe(a);
  });
});
