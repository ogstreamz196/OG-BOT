import { describe, expect, it } from "vitest";
import { cleanPin, pinError, parseStoredPin, PIN_MIN } from "./tweaker-pin";

describe("tweaker PIN helpers", () => {
  it("cleans to digits only and caps the length", () => {
    expect(cleanPin(" 12-34ab")).toBe("1234");
    expect(cleanPin("123456789012345")).toHaveLength(12);
    expect(cleanPin(null)).toBe("");
  });
  it("rejects a PIN shorter than the minimum, accepts a long one", () => {
    expect(pinError("12")).toMatch(/at least/);
    expect(pinError("1".repeat(PIN_MIN))).toBeNull();
    expect(pinError("12345678")).toBeNull();
  });
  it("parses a stored salt:hash, and nothing when unset", () => {
    expect(parseStoredPin("abc:def")).toEqual({ salt: "abc", hash: "def" });
    expect(parseStoredPin("")).toBeNull();
    expect(parseStoredPin("noseparator")).toBeNull();
    expect(parseStoredPin(null)).toBeNull();
  });
});
