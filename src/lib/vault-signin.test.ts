import { describe, expect, it } from "vitest";
import { vaultFresh, vaultLoginEmail, vaultSignature, vaultSignatureOk } from "./vault-signin";

describe("vault sign-in check", () => {
  const body = '{"username":"bob","password":"x","ts":1}';
  it("accepts the right signature and refuses a wrong one", () => {
    expect(vaultSignatureOk("s3cret", body, vaultSignature("s3cret", body))).toBe(true);
    expect(vaultSignatureOk("s3cret", body, vaultSignature("other", body))).toBe(false);
    expect(vaultSignatureOk("s3cret", body, null)).toBe(false);
  });
  it("refuses requests more than 2 minutes old", () => {
    expect(vaultFresh(1_000_000, 1_000_000 + 119_000)).toBe(true);
    expect(vaultFresh(1_000_000, 1_000_000 + 121_000)).toBe(false);
  });
  it("maps a username to the same login as the website", () => {
    expect(vaultLoginEmail(" Big.Bob! ")).toBe("big.bob@ogstreamz.app");
  });
});
