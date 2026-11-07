import { describe, expect, it } from "vitest";
import { cleanTuningPatch, TWEAK_FIELDS } from "./trade-tweaker";
import { DEFAULT_TUNING, type Tuning } from "./trade-signal";

describe("TradeTweaker fields", () => {
  it("covers exactly the knobs in the Tuning type (nothing missing, nothing extra)", () => {
    const fieldKeys = [...TWEAK_FIELDS.map((f) => f.key)].sort();
    const tuningKeys = (Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]).sort();
    expect(fieldKeys).toEqual(tuningKeys);
  });
});

describe("cleanTuningPatch", () => {
  it("coerces numeric strings and rounds integer-only knobs", () => {
    // Integer knobs are rounded to a whole number here; safeTuning does any
    // further step-snapping (e.g. holdFor to the nearest 5) on the server.
    const out = cleanTuningPatch({ minConfidence: "73", pullback: "0.15", holdFor: "42" });
    expect(out).toEqual({ minConfidence: 73, pullback: 0.15, holdFor: 42 });
  });
  it("takes a 3-number scale and a clean, sorted, de-duped, in-range block list", () => {
    expect(cleanTuningPatch({ scale: ["0.8", 0.6, 0.85] }).scale).toEqual([0.8, 0.6, 0.85]);
    expect(cleanTuningPatch({ skipBlocks: [5, 2, 2, 9, -1, 0] }).skipBlocks).toEqual([0, 2, 5]);
  });
  it("drops unknown keys, bad types and junk so safeTuning never sees them", () => {
    expect(
      cleanTuningPatch({ stopRoom: "nope", scale: [1, 2], evil: 1, minVol: Infinity }),
    ).toEqual({});
    expect(cleanTuningPatch(null)).toEqual({});
  });
});
