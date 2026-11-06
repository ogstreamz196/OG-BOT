import { describe, expect, it } from "vitest";
import { DEV_ACCOUNT_EMAIL, isDevPinUser, readDevPinCheck } from "./dev-pin";

describe("dev.b055 sign-in", () => {
  it("only dev.b055 (any case, spaces trimmed) uses the dev PIN", () => {
    expect(isDevPinUser("dev.b055")).toBe(true);
    expect(isDevPinUser("  DEV.B055 ")).toBe(true);
    expect(isDevPinUser("dev.b033")).toBe(false);
    expect(isDevPinUser("ogstreamz196@gmail.com")).toBe(false);
    expect(isDevPinUser(null)).toBe(false);
  });

  it("signs in to the Boss's D.EV account", () => {
    expect(DEV_ACCOUNT_EMAIL).toBe("ogstreamz196@gmail.com");
  });

  it("reads the hub's answer safely", () => {
    expect(readDevPinCheck({ ok: true })).toEqual({ ok: true });
    expect(
      readDevPinCheck({ ok: false, code: "wrong", message: "Wrong PIN. 4 tries left." }),
    ).toEqual({
      ok: false,
      code: "wrong",
      message: "Wrong PIN. 4 tries left.",
    });
    expect(
      readDevPinCheck({ ok: false, code: "locked", message: "Too many wrong PINs." }).code,
    ).toBe("locked");
    // Anything odd is just a wrong PIN, never a sign-in.
    expect(readDevPinCheck(null)).toEqual({ ok: false, code: undefined, message: "Wrong PIN." });
    expect(readDevPinCheck({ ok: "true" }).ok).toBe(false);
    expect(readDevPinCheck({ ok: false, message: "x".repeat(500) }).message).toBe("Wrong PIN.");
  });
});
