import { describe, expect, it } from "vitest";
import { detectTradeIntent, parseInstrument } from "./trade-signal";
import { BOARD_MARKETS } from "./signals-board.functions";

describe("OG Signals board markets", () => {
  it("each one resolves to its own market for both timeframes", () => {
    for (const m of BOARD_MARKETS) {
      expect(parseInstrument(m.ask)?.code, m.ask).toBe(m.code);
      for (const tf of ["1h", "15m"]) {
        expect(detectTradeIntent(`${m.ask} signal ${tf}`)?.code, `${m.ask} ${tf}`).toBe(m.code);
      }
    }
  });
});
