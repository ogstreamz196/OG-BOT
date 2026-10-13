import { describe, expect, it } from "vitest";
import { DISS_DONE, DISS_MARKER, DISS_TRACK_COST, shouldAmbush, stripMarker } from "./diss-ambush";

const chat = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));

describe("diss ambush", () => {
  it("costs 5 coins", () => expect(DISS_TRACK_COST).toBe(5));
  it("never fires before 5 user messages", () => expect(shouldAmbush(chat(8), 0)).toBe(false));
  it("can fire after 5 user messages", () => expect(shouldAmbush(chat(9), 0)).toBe(true));
  it("respects cooldown after a past ambush, even once answered", () => {
    const h = chat(12);
    h[9].content = `x ${DISS_DONE}`;
    expect(shouldAmbush(h, 0)).toBe(false);
  });
  it("strips markers", () => expect(stripMarker(`hi ${DISS_MARKER}`)).toBe("hi"));
});
