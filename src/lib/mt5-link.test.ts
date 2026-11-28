import { describe, expect, it } from "vitest";
import { checkConnectInput, parseLink } from "./mt5-link.server";

const base = { mode: "demo" as const, login: "12345678", server: "Vantage-Demo", password: "secret" };

describe("checkConnectInput", () => {
  it("accepts a demo account with a valid login and server", () => {
    expect(checkConnectInput(base)).toBeNull();
  });
  it("refuses a login that isn't digits", () => {
    expect(checkConnectInput({ ...base, login: "mia@example.com" })).toMatch(/digits/);
  });
  it("refuses a server with odd characters", () => {
    expect(checkConnectInput({ ...base, server: "Vantage;drop" })).toMatch(/server/);
  });
  it("refuses an empty password", () => {
    expect(checkConnectInput({ ...base, password: "" })).toMatch(/password/);
  });
  it("needs LIVE typed before a live account is connected", () => {
    expect(checkConnectInput({ ...base, mode: "live" })).toMatch(/LIVE/);
    expect(checkConnectInput({ ...base, mode: "live", confirm: "live" })).toMatch(/LIVE/);
    expect(checkConnectInput({ ...base, mode: "live", confirm: " LIVE " })).toBeNull();
  });
});

describe("parseLink", () => {
  it("reads a saved link and never keeps a password field", () => {
    const raw = JSON.stringify({ id: "abc", mode: "live", login: "1", server: "S", name: "n", linkedAt: "t", password: "x" });
    const acc = parseLink(raw);
    expect(acc).toEqual({ id: "abc", mode: "live", login: "1", server: "S", name: "n", linkedAt: "t" });
    expect(acc).not.toHaveProperty("password");
  });
  it("treats anything unusual as no link", () => {
    expect(parseLink(null)).toBeNull();
    expect(parseLink("not json")).toBeNull();
    expect(parseLink(JSON.stringify({ login: "1" }))).toBeNull();
  });
  it("defaults an unknown mode to demo", () => {
    expect(parseLink(JSON.stringify({ id: "a", mode: "weird" }))?.mode).toBe("demo");
  });
});
