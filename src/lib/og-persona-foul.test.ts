import { describe, expect, it } from "vitest";
import { ensureFoulFlavour, hasFoulFlavour } from "./og-persona.server";

describe("ensureFoulFlavour", () => {
  it("leaves already-foul replies untouched", () => {
    const t = "Swansea play Saturday, you fucking muppet.";
    expect(ensureFoulFlavour(t)).toBe(t);
  });
  it("seasons clean replies and keeps the body intact", () => {
    const t = "Kick-off is 12:20 on Paramount+ https://ogbot.co.uk/sports";
    const out = ensureFoulFlavour(t, () => 0.1);
    expect(hasFoulFlavour(out)).toBe(true);
    expect(out).toContain("https://ogbot.co.uk/sports");
    expect(ensureFoulFlavour(t, () => 0.9)).toContain(t);
  });
  it("ignores empty replies", () => {
    expect(ensureFoulFlavour("…")).toBe("…");
  });
});
