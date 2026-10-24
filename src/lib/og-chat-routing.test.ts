import { describe, it, expect } from "vitest";
import { routeOgMessage } from "./og-chat-routing";
import { QUICK_STARTS } from "./og-persona-public";

describe("routeOgMessage — Live Chat vs Private OG B0T regression", () => {
  it("routes plain text to private when Live Chat is OFF", () => {
    expect(routeOgMessage({ shareLive: false, text: "hi" })).toBe("private");
  });

  it("routes plain text to community when Live Chat is ON", () => {
    expect(routeOgMessage({ shareLive: true, text: "hi" })).toBe("community");
  });

  it("ALWAYS routes forcePrivate to private, even when Live Chat is ON", () => {
    expect(routeOgMessage({ shareLive: true, forcePrivate: true, text: "hi" })).toBe("private");
  });

  it("returns noop for empty text + no attachment", () => {
    expect(routeOgMessage({ shareLive: false, text: "" })).toBe("noop");
    expect(routeOgMessage({ shareLive: true, text: "" })).toBe("noop");
  });

  it("attachment-only goes private regardless of Live Chat (community is text-only)", () => {
    expect(routeOgMessage({ shareLive: false, text: "", hasAttachment: true })).toBe("private");
    expect(routeOgMessage({ shareLive: true, text: "", hasAttachment: true })).toBe("noop");
  });

  it("every quick-start chip resolves to private when invoked with forcePrivate, even with Live Chat ON", () => {
    expect(QUICK_STARTS.length).toBeGreaterThan(0);
    for (const q of QUICK_STARTS) {
      const target = routeOgMessage({
        shareLive: true,
        forcePrivate: true,
        text: q.prompt.trim(),
      });
      expect(target, `quick-start "${q.label}" must go private`).toBe("private");
    }
  });

  it("without forcePrivate, the same quick-start text would leak into community when Live Chat is ON (regression guard)", () => {
    const q = QUICK_STARTS[0];
    expect(routeOgMessage({ shareLive: true, text: q.prompt.trim() })).toBe("community");
  });
});
