import { describe, expect, it } from "vitest";
import { cached, forgetCached } from "./server-cache";

describe("server cache", () => {
  it("loads once within the ttl and shares in-flight loads", async () => {
    let calls = 0;
    const load = async () => ++calls;
    const [a, b] = await Promise.all([cached("t1", 60_000, load), cached("t1", 60_000, load)]);
    expect([a, b, await cached("t1", 60_000, load)]).toEqual([1, 1, 1]);
    forgetCached("t1");
    expect(await cached("t1", 60_000, load)).toBe(2);
  });

  it("reloads after the ttl", async () => {
    let calls = 0;
    await cached("t2", 0, async () => ++calls);
    expect(await cached("t2", 0, async () => ++calls)).toBe(2);
  });

  it("never keeps a failed load", async () => {
    await expect(
      cached("t3", 60_000, async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
    expect(await cached("t3", 60_000, async () => "ok")).toBe("ok");
  });
});
