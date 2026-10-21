import { describe, expect, it } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { joinSharedChannel } from "./shared-realtime";

function fakeClient() {
  const made: { topic: string; handler?: (p: unknown) => void; subscribed: boolean }[] = [];
  const removed: unknown[] = [];
  const client = {
    channel(topic: string) {
      const ch = {
        topic,
        handler: undefined as ((p: unknown) => void) | undefined,
        subscribed: false,
        on(_e: string, _f: unknown, h: (p: unknown) => void) {
          ch.handler = h;
          return ch;
        },
        subscribe() {
          ch.subscribed = true;
          return ch;
        },
      };
      made.push(ch);
      return ch as unknown as RealtimeChannel;
    },
    removeChannel(ch: unknown) {
      removed.push(ch);
      return Promise.resolve("ok" as const);
    },
  };
  return { client: client as never, made, removed };
}

const bind = (ch: RealtimeChannel, emit: (p: unknown) => void) =>
  ch.on("postgres_changes" as never, {} as never, emit as never);

describe("shared realtime channels", () => {
  it("opens one channel per key and closes it with the last subscriber", () => {
    const { client, made, removed } = fakeClient();
    const leaveA = joinSharedChannel("k1", bind, undefined, client);
    const leaveB = joinSharedChannel("k1", bind, undefined, client);
    expect(made).toHaveLength(1);
    expect(made[0].subscribed).toBe(true);
    leaveA();
    leaveA(); // leaving twice is harmless
    expect(removed).toHaveLength(0);
    leaveB();
    expect(removed).toHaveLength(1);
    // A later subscriber gets a fresh channel.
    joinSharedChannel("k1", bind, undefined, client)();
    expect(made).toHaveLength(2);
  });

  it("fans each event out to every subscriber's latest listener", () => {
    const { client, made } = fakeClient();
    const got: string[] = [];
    const a = { current: (p: unknown) => got.push(`a:${p}`) };
    const b = { current: (p: unknown) => got.push(`b:${p}`) };
    const leaveA = joinSharedChannel("k2", bind, a, client);
    const leaveB = joinSharedChannel("k2", bind, b, client);
    made[0].handler?.("x");
    b.current = (p: unknown) => got.push(`b2:${p}`);
    leaveA();
    made[0].handler?.("y");
    expect(got).toEqual(["a:x", "b:x", "b2:y"]);
    leaveB();
  });

  it("keeps different keys apart", () => {
    const { client, made } = fakeClient();
    const l1 = joinSharedChannel("k3", bind, undefined, client);
    const l2 = joinSharedChannel("k4", bind, undefined, client);
    expect(made).toHaveLength(2);
    l1();
    l2();
  });
});
