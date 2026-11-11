import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MessengerMode } from "@/hooks/use-messenger-mode";
import {
  isCommunityMode,
  modeHeading,
  modeBadge,
  toggleActionLabel,
  toggleAriaLabel,
  nextMode,
} from "./messenger-mode-labels";

const MODES: MessengerMode[] = ["loner", "community"];

describe("messenger mode labels", () => {
  it("isCommunityMode matches the stored value", () => {
    expect(isCommunityMode("community")).toBe(true);
    expect(isCommunityMode("loner")).toBe(false);
  });

  it("heading + badge always match the underlying mode", () => {
    for (const mode of MODES) {
      const isCommunity = mode === "community";
      expect(modeHeading(mode)).toBe(isCommunity ? "OG Battle Zone" : "OG B0T Loner Mode");
      expect(modeBadge(mode)).toContain(isCommunity ? "OG Battle Zone" : "OG B0T Loner Mode");
    }
  });

  it("visible toggle label states the NEXT action (opposite of current mode)", () => {
    expect(toggleActionLabel("community", false)).toBe("Start Private Mode");
    expect(toggleActionLabel("loner", false)).toBe("Leave Private Mode");
  });

  it("shows 'Saving…' while a mutation is in flight regardless of mode", () => {
    for (const mode of MODES) {
      expect(toggleActionLabel(mode, true)).toBe("Saving…");
    }
  });

  it("aria-label mirrors the visible action (turn on/off the OPPOSITE mode)", () => {
    for (const mode of MODES) {
      const aria = toggleAriaLabel(mode);
      const visible = toggleActionLabel(mode, false);
      // If the pill says "Turn on …", the aria-label must too — never drift.
      expect(aria.startsWith(visible.split(" ").slice(0, 2).join(" "))).toBe(true);
    }
  });

  it("nextMode flips loner ↔ community and is its own inverse", () => {
    for (const mode of MODES) {
      expect(nextMode(mode)).not.toBe(mode);
      expect(nextMode(nextMode(mode))).toBe(mode);
    }
  });

  it("messenger route uses the shared label helpers (no inline drift)", () => {
    const src = readFileSync(
      join(__dirname, "..", "routes", "_authenticated", "messenger.tsx"),
      "utf8",
    );
    // Either imports the helpers, or keeps the exact strings the helpers own.
    const usesHelpers = /from\s+["']@\/lib\/messenger-mode-labels["']/.test(src);
    const keepsStrings =
      src.includes("Start Private Mode") &&
      src.includes("Leave Private Mode") &&
      src.includes("OG Battle Zone") &&
      src.includes("OG B0T Loner Mode");
    expect(usesHelpers || keepsStrings).toBe(true);
  });
});
