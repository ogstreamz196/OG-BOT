import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/telegram-fleet.functions", () => ({ listFleet: vi.fn() }));
vi.mock("@/lib/signals-chat.functions", () => ({ getSignalsChatState: vi.fn() }));
vi.mock("@/lib/public-settings.functions", () => ({ getPublicAppSettings: vi.fn() }));

// The Boss's live switches, summed up for the Command Bar and Switchboard.
describe("boss switches", () => {
  it("sums up the fleet: bots on, webhooks answering, the copy bot", async () => {
    const { fleetSummary } = await import("./use-boss-switches");
    const row = (o: object) => ({
      id: "1",
      username: null,
      role: "assistant",
      enabled: true,
      webhook_connected: true,
      ...o,
    });
    expect(
      fleetSummary([
        row({}),
        row({ role: "copy", username: "ogcopybot" }),
        row({ enabled: false, webhook_connected: false }),
      ]),
    ).toEqual({ active: 2, total: 3, webhookOk: true, copyBot: "@ogcopybot" });
    expect(fleetSummary([row({ webhook_connected: false })]).webhookOk).toBe(false);
    expect(fleetSummary([]).webhookOk).toBe(false);
  });

  it("says how long free access has left", async () => {
    const { expiresIn } = await import("./use-boss-switches");
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(expiresIn("2026-11-02T12:25:00Z", now)).toBe("in 25m");
    expect(expiresIn("2026-11-02T15:00:00Z", now)).toBe("in 3h");
    expect(expiresIn("2026-11-09T12:00:00Z", now)).toBe("in 7d");
    expect(expiresIn("2026-11-02T11:00:00Z", now)).toBeNull();
    expect(expiresIn(null, now)).toBeNull();
  });

  it("never uses blue text on the new Boss surfaces", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "src/components/admin/BossCommandBar.tsx",
      "src/components/settings/BossControls.tsx",
    ])
      expect(readFileSync(f, "utf8")).not.toMatch(/text-(blue|cyan|sky|indigo)-/);
  });
});
