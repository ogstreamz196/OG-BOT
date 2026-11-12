import { describe, expect, it } from "vitest";
import {
  checkAccess,
  daysLeft,
  extendKey,
  helloFrom,
  newKey,
  parseKey,
  parseKeyCommand,
  parseKeyTap,
  resetLock,
  restoreKey,
  revokeKey,
  userPanel,
  usersPanel,
  type CopierKey,
} from "./copier-keys";

const now = Date.parse("2026-11-13T12:00:00Z");
const hash = "ab12cd34ef".padEnd(64, "0");
const fresh = (): CopierKey => newKey(hash, "Sam", 30, now);
const hello = (over: Partial<ReturnType<typeof helloFrom>> = {}) => ({
  stick: "disk-AAA111",
  account: "123456",
  instance: "run1",
  balance: 500,
  ...over,
});

describe("a user's copier key", () => {
  it("is made with a name and days, and survives being stored", () => {
    const k = fresh();
    expect(k.id).toBe("ab12cd34ef");
    expect(daysLeft(k, now)).toBe(30);
    expect(parseKey(JSON.stringify(k))).toEqual(k);
    expect(parseKey("junk")).toBeNull();
    expect(parseKey(JSON.stringify({ id: "nope" }))).toBeNull();
  });

  it("locks to the stick and MT5 account on first use", () => {
    const a = checkAccess(fresh(), hello(), now);
    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    expect(a.save).toBe(true);
    expect(a.key).toMatchObject({ stick: "disk-AAA111", account: "123456", balance: 500 });
  });

  it("refuses another stick or another MT5 account afterwards", () => {
    const bound = (checkAccess(fresh(), hello(), now) as { key: CopierKey }).key;
    const later = now + 60_000;
    expect(checkAccess(bound, hello({ stick: "disk-BBB222" }), later)).toEqual({
      status: "refused",
      reason: "wrong_stick",
    });
    expect(checkAccess(bound, hello({ account: "999" }), later)).toEqual({
      status: "refused",
      reason: "wrong_account",
    });
  });

  it("refuses a copier that doesn't say which stick and account it's on", () => {
    expect(checkAccess(fresh(), hello({ stick: "" }), now)).toMatchObject({
      status: "refused",
      reason: "update_needed",
    });
  });

  it("runs one copy at a time, and lets a restart in once the old one has gone quiet", () => {
    const bound = (checkAccess(fresh(), hello(), now) as { key: CopierKey }).key;
    expect(checkAccess(bound, hello({ instance: "run2" }), now + 10_000)).toEqual({
      status: "refused",
      reason: "running_elsewhere",
    });
    expect(checkAccess(bound, hello({ instance: "run2" }), now + 60_000).status).toBe("ok");
  });

  it("only rewrites the row now and then while it keeps running", () => {
    const bound = (checkAccess(fresh(), hello(), now) as { key: CopierKey }).key;
    const soon = checkAccess(bound, hello(), now + 5_000);
    expect(soon.status === "ok" && soon.save).toBe(false);
    const later = checkAccess(bound, hello(), now + 31_000);
    expect(later.status === "ok" && later.save).toBe(true);
  });

  it("expired or switched off: still served, but limited (paused)", () => {
    const k = fresh();
    expect(checkAccess(k, hello(), now + 31 * 86_400_000)).toMatchObject({
      status: "limited",
      reason: "expired",
    });
    expect(checkAccess(revokeKey(k), hello(), now)).toMatchObject({
      status: "limited",
      reason: "revoked",
    });
    expect(checkAccess(restoreKey(revokeKey(k)), hello(), now).status).toBe("ok");
  });

  it("the Boss can add days and reset the lock", () => {
    const k = fresh();
    expect(daysLeft(extendKey(k, 7, now), now)).toBe(37);
    // Once expired, the days count from today.
    const late = now + 40 * 86_400_000;
    expect(daysLeft(extendKey(k, 7, late), late)).toBe(7);
    const bound = (checkAccess(k, hello(), now) as { key: CopierKey }).key;
    const cleared = resetLock(bound);
    expect(cleared.stick).toBeUndefined();
    expect(cleared.account).toBeUndefined();
    expect(checkAccess(cleared, hello({ stick: "disk-NEW", instance: "x" }), now).status).toBe(
      "ok",
    );
  });

  it("reads the copier's headers and drops junk", () => {
    const h = new Headers({
      "x-copy-stick": " disk-AAA111 ",
      "x-copy-account": "12a34",
      "x-copy-instance": "abc",
      "x-copy-balance": "-4",
    });
    expect(helloFrom(h)).toEqual({
      stick: "disk-AAA111",
      account: "1234",
      instance: "abc",
      balance: null,
    });
  });
});

describe("the Boss's users cards", () => {
  it("lists users with their state and how to add one", () => {
    const p = usersPanel([fresh(), revokeKey({ ...fresh(), id: "1111111111", name: "Ali" })], now);
    expect(p.text).toContain("Sam: ✅ 30 days left");
    expect(p.text).toContain("Ali: ⛔ switched off");
    expect(p.text).toContain("/adduser Name 30");
    expect(usersPanel([], now).text).toContain("Nobody yet.");
  });

  it("every button fits Telegram's 64 bytes and is understood", () => {
    const datas = [
      ...usersPanel([fresh()], now).reply_markup.inline_keyboard,
      ...userPanel(fresh(), now).reply_markup.inline_keyboard,
      ...userPanel(revokeKey(fresh()), now, undefined, true).reply_markup.inline_keyboard,
    ]
      .flat()
      .map((b) => b.callback_data);
    for (const d of datas) {
      expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
      expect(parseKeyTap(d)).not.toBeNull();
    }
    expect(parseKeyTap("ck:x:ab12cd34ef:30")).toEqual({ do: "extend", id: "ab12cd34ef", days: 30 });
    expect(parseKeyTap("ck:x:ab12cd34ef:999")).toBeNull();
    expect(parseKeyTap("ck:u:nothex")).toBeNull();
    expect(parseKeyTap("cs:pause")).toBeNull();
  });

  it("removing takes two taps", () => {
    const first = userPanel(fresh(), now).reply_markup.inline_keyboard.flat();
    expect(first.some((b) => b.callback_data.startsWith("ck:dy:"))).toBe(false);
    const second = userPanel(fresh(), now, undefined, true).reply_markup.inline_keyboard.flat();
    expect(second.some((b) => b.callback_data.startsWith("ck:dy:"))).toBe(true);
  });

  it("understands /users and /adduser", () => {
    expect(parseKeyCommand("/users")).toEqual({ cmd: "users" });
    expect(parseKeyCommand("👥 Copier users")).toEqual({ cmd: "users" });
    expect(parseKeyCommand("/adduser Big Sam 30")).toEqual({
      cmd: "add",
      name: "Big Sam",
      days: 30,
    });
    expect(parseKeyCommand("/adduser Sam")).toEqual({ cmd: "badadd" });
    expect(parseKeyCommand("/adduser 30")).toEqual({ cmd: "badadd" });
    expect(parseKeyCommand("hello")).toBeNull();
  });
});
