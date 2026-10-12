import { describe, expect, it } from "vitest";
import {
  SIGNATURE_LINE,
  injectSignature,
  withSignatureHint,
} from "../../supabase/functions/_shared/track-signature";

const count = (s: string) => s.split(SIGNATURE_LINE).length - 1;

describe("track signature", () => {
  it("tags a short lyric sheet exactly once", () => {
    const lyrics = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const out = injectSignature(lyrics)!;
    expect(count(out)).toBe(1);
    expect(out.startsWith("line 0")).toBe(true);
  });

  it("adds the tag exactly once, at the very end, even for a long sheet", () => {
    const lyrics = Array.from({ length: 42 }, (_, i) => `line ${i}`).join("\n");
    const out = injectSignature(lyrics)!;
    expect(count(out)).toBe(1);
    expect(out.trimEnd().endsWith("O G Bot dot co dot uk")).toBe(true);
  });

  it("never double-tags", () => {
    const once = injectSignature("a\nb\nc\nd\ne")!;
    expect(count(injectSignature(once)!)).toBe(1);
  });

  it("keeps section headers intact", () => {
    const out = injectSignature("[Verse 1]\na\nb\nc\nd\n[Chorus]\ne\nf")!;
    expect(out).toContain("[Verse 1]");
    expect(out).toContain("[Chorus]");
  });

  it("adds a hint to prompt-only generations", () => {
    const p = withSignatureHint("a sad drill song in Romanian");
    expect(p.toLowerCase()).toContain("this track was made by o g bot dot co dot uk");
    expect(p.toLowerCase()).not.toContain("og streamz");
    expect(withSignatureHint(p)).toBe(p);
  });

  it("leaves empty input alone", () => {
    expect(injectSignature("")).toBe("");
    expect(injectSignature(null)).toBe(null);
  });
});
