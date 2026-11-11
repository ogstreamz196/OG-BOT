import { describe, expect, it } from "vitest";
import { repeatWithin } from "./repeat-within";

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => void (t += ms),
    advance: (ms: number) => (t += ms),
  };
}

describe("repeatWithin", () => {
  it("runs straight away, then every interval, up to the last start time", async () => {
    const clock = fakeClock();
    const at: number[] = [];
    await repeatWithin(
      async () => void at.push(clock.now()),
      { everyMs: 12_000, lastStartMs: 36_000 },
      clock,
    );
    expect(at).toEqual([0, 12_000, 24_000, 36_000]);
  });

  it("skips a run that a slow one pushed past the cut-off", async () => {
    const clock = fakeClock();
    const at: number[] = [];
    await repeatWithin(
      async () => {
        at.push(clock.now());
        clock.advance(20_000); // each run takes 20s
      },
      { everyMs: 15_000, lastStartMs: 30_000 },
      clock,
    );
    expect(at).toEqual([0, 20_000]);
  });

  it("carries on after a failed run", async () => {
    const clock = fakeClock();
    const out = await repeatWithin(
      async (pass) => {
        if (pass === 0) throw new Error("feed down");
        return pass;
      },
      { everyMs: 10_000, lastStartMs: 20_000 },
      clock,
    );
    expect(out).toEqual([1, 2]);
  });
});
