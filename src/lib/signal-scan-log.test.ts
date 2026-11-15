import { describe, expect, it } from "vitest";
import {
  addRun,
  cleanScanLog,
  KEEP_RUNS,
  scanStatus,
  summariseRun,
  type ScanLog,
} from "./signal-scan-log";
import {
  applyGroupTap,
  cleanEngineConfig,
  DEFAULT_ENGINE_CONFIG,
  groupAllows,
} from "./engine-config";

const NOW = Date.parse("2026-11-15T12:00:00Z");

describe("scan log", () => {
  it("sums a run and keeps the most confident setup that didn't go out", () => {
    const r = summariseRun(NOW, [
      { market: "BTCUSD", frame: "5m", outcome: "below_bar", confidence: 58, detail: "needs 65%" },
      { market: "XAUUSD", frame: "1m", outcome: "desk_no", confidence: 72 },
      { market: "BTCUSD", frame: "1h", outcome: "waiting" },
      { market: "BTCUSD", frame: "15m", outcome: "posted", confidence: 90 },
    ]);
    expect(r).toMatchObject({
      checked: 4,
      posted: 1,
      counts: { below_bar: 1, desk_no: 1, waiting: 1, posted: 1 },
    });
    expect(r.best).toMatchObject({ market: "XAUUSD", confidence: 72, outcome: "desk_no" });
  });

  it("keeps the newest runs and remembers the last post", () => {
    let log: ScanLog = cleanScanLog({});
    for (let i = 0; i < KEEP_RUNS + 5; i++)
      log = addRun(
        log,
        summariseRun(
          NOW + i * 60_000,
          i === 3 ? [{ market: "BTCUSD", frame: "5m", outcome: "posted" }] : [],
        ),
      );
    expect(log.runs).toHaveLength(KEEP_RUNS);
    expect(log.lastPostAt).toBe(NOW + 3 * 60_000);
  });

  it("says why nothing's going out", () => {
    let log: ScanLog = cleanScanLog({});
    for (let i = 0; i < 10; i++)
      log = addRun(
        log,
        summariseRun(NOW - (10 - i) * 60_000, [
          { market: "BTCUSD", frame: "5m", outcome: "below_bar", confidence: 60 },
          { market: "XAUUSD", frame: "5m", outcome: "waiting" },
          { market: "BTCUSD", frame: "1m", outcome: "below_bar", confidence: 55 },
        ]),
      );
    const lines = scanStatus(log, NOW);
    expect(lines[0]).toMatch(/Last signal: none/);
    expect(lines.join("\n")).toMatch(/Best: BTCUSD 5m at 60%/);
    expect(lines.join("\n")).toMatch(/Last hour, mostly: setup under the confidence floor \(20\)/);
  });

  it("warns when the minute scan has stopped, and shows skips", () => {
    const log = addRun(
      cleanScanLog({}),
      summariseRun(NOW - 30 * 60_000, [], "posting is switched off on the switchboard"),
    );
    const text = scanStatus(log, NOW).join("\n");
    expect(text).toMatch(/may have stopped running/);
    expect(text).toMatch(/skipped \(posting is switched off/);
  });
});

describe("group switches", () => {
  it("default on, cleaned, and obeyed per market", () => {
    expect(DEFAULT_ENGINE_CONFIG.group).toEqual({
      posting: true,
      gold: true,
      bitcoin: true,
      deskCheck: true,
    });
    const c = cleanEngineConfig({ group: { gold: false, posting: "nope" } });
    expect(c.group).toEqual({ posting: true, gold: false, bitcoin: true, deskCheck: true });
    expect(groupAllows(c.group, "XAUUSD")).toBe(false);
    expect(groupAllows(c.group, "BTCUSD")).toBe(true);
    expect(groupAllows({ ...c.group, posting: false }, "BTCUSD")).toBe(false);
  });
  it("taps flip one switch", () => {
    const r = applyGroupTap(DEFAULT_ENGINE_CONFIG, "eg:posting:off");
    expect(r.next?.group.posting).toBe(false);
    expect(r.toast).toMatch(/posting: OFF/);
    expect(applyGroupTap(DEFAULT_ENGINE_CONFIG, "eg:evil:on").next).toBeNull();
  });
});
