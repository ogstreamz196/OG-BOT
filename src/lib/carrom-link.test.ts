import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  guestNameCandidates,
  isCarromUsername,
  signCarromGuestPass,
  signCarromPass,
  verifyCarromGuestPass,
  verifyCarromPass,
} from "./carrom-link.server";

const real = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});
afterEach(() => {
  if (real === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = real;
});

const uid = "11111111-2222-3333-4444-555555555555";

describe("OG Carrom pass", () => {
  it("round-trips the account id and name", async () => {
    const token = await signCarromPass({ userId: uid, name: "Imran" });
    expect(await verifyCarromPass(token)).toEqual({ userId: uid, name: "Imran" });
  });

  it("refuses a tampered pass", async () => {
    const token = await signCarromPass({ userId: uid, name: "Imran" });
    const [payload, sig] = token.split(".");
    const other = btoa(JSON.stringify({ u: "someone-else", n: "x", e: 9999999999 }))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(await verifyCarromPass(`${other}.${sig}`)).toBeNull();
    expect(await verifyCarromPass(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(await verifyCarromPass("nonsense")).toBeNull();
  });

  it("expires after 5 minutes", async () => {
    const t0 = Date.UTC(2026, 9, 20, 12);
    const token = await signCarromPass({ userId: uid, name: "Imran" }, t0);
    expect(await verifyCarromPass(token, t0 + 4 * 60_000)).not.toBeNull();
    expect(await verifyCarromPass(token, t0 + 6 * 60_000)).toBeNull();
  });

  it("can't be forged without this server's key", async () => {
    const token = await signCarromPass({ userId: uid, name: "Imran" });
    process.env.SUPABASE_SERVICE_ROLE_KEY = "a-different-key";
    expect(await verifyCarromPass(token)).toBeNull();
  });

  it("carries the phone app's challenge, and only a well-formed one", async () => {
    const challenge = "A".repeat(42) + "_";
    const token = await signCarromPass({ userId: uid, name: "Imran", challenge });
    expect(await verifyCarromPass(token)).toEqual({ userId: uid, name: "Imran", challenge });
    const bad = await signCarromPass({ userId: uid, name: "Imran", challenge: "short" });
    expect(await verifyCarromPass(bad)).toEqual({ userId: uid, name: "Imran" });
  });
});

describe("OG Carrom guest pass", () => {
  it("round-trips a random guest id and lasts a day", async () => {
    const now = Date.UTC(2026, 9, 25, 12);
    const token = await signCarromGuestPass(now);
    const pass = await verifyCarromGuestPass(token, now);
    expect(pass?.guestId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await verifyCarromGuestPass(token, now + 23 * 3600_000)).toEqual(pass);
    expect(await verifyCarromGuestPass(token, now + 25 * 3600_000)).toBeNull();
    // Each pass is a different guest.
    const other = await verifyCarromGuestPass(await signCarromGuestPass(now), now);
    expect(other?.guestId).not.toBe(pass?.guestId);
  });

  it("can't be forged, and member and guest passes don't mix", async () => {
    const guest = await signCarromGuestPass();
    const [payload, sig] = guest.split(".");
    expect(await verifyCarromGuestPass(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(await verifyCarromPass(guest)).toBeNull();
    const member = await signCarromPass({ userId: uid, name: "Imran" });
    expect(await verifyCarromGuestPass(member)).toBeNull();
  });

  it("only takes carrom-style usernames, and numbers them when taken", () => {
    expect(isCarromUsername("Faiyaz786")).toBe(true);
    expect(isCarromUsername("ab")).toBe(false);
    expect(isCarromUsername("has space")).toBe(false);
    expect(isCarromUsername("x".repeat(17))).toBe(false);
    const names = [...guestNameCandidates("QueenHunter12345")].slice(0, 3);
    expect(names).toEqual(["QueenHunter12345", "QueenHunter123_2", "QueenHunter123_3"]);
    expect(names.every((n) => isCarromUsername(n))).toBe(true);
  });
});
