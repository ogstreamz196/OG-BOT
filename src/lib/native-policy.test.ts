import { describe, expect, it } from "vitest";
import { storeItemAllowed } from "./native-policy";

describe("what stays out of the phone apps", () => {
  it("the website sells everything; the apps never sell the Vault Pass", () => {
    expect(storeItemAllowed("og-vip-pass", false)).toBe(true);
    expect(storeItemAllowed("og-vip-pass", true)).toBe(false);
    expect(storeItemAllowed("og-sports-guide-access", true)).toBe(true);
    expect(storeItemAllowed(null, true)).toBe(true);
  });
});
