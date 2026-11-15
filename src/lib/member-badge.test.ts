import { describe, expect, it } from "vitest";
import { memberBadge } from "./member-badge";

describe("memberBadge", () => {
  it("REAL OG needs both PRO and the Vault pass", () => {
    expect(memberBadge({ pro: true, vaultPass: true })).toBe("REAL OG");
    expect(memberBadge({ pro: true, vaultPass: false })).toBe("PRO");
    expect(memberBadge({ pro: false, vaultPass: true })).toBeNull();
    expect(memberBadge({ pro: false, vaultPass: false })).toBeNull();
  });
});
