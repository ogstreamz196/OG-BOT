import { describe, expect, it } from "vitest";
import { copyText, newId } from "./copy-text";

describe("newId", () => {
  it("always gives a UUID-shaped id, even without crypto.randomUUID", () => {
    const real = globalThis.crypto.randomUUID;
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newId()).toMatch(re);
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    try {
      const a = newId();
      expect(a).toMatch(re);
      expect(newId()).not.toBe(a);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: real, configurable: true });
    }
  });
});

describe("copyText", () => {
  it("never throws and says false when nothing can copy", async () => {
    await expect(copyText("hi")).resolves.toBe(false);
  });
});
