import { describe, expect, it } from "vitest";
import { parseOgChatInput } from "./og-chat-input";

describe("parseOgChatInput", () => {
  const messages = [{ role: "user" as const, content: "gold signal" }];
  it("marks chats from the phone apps, so they never get trading signals", () => {
    expect(parseOgChatInput({ messages, nativeApp: true }).nativeApp).toBe(true);
    expect(parseOgChatInput({ messages }).nativeApp).toBe(false);
    // Only a real true counts.
    expect(parseOgChatInput({ messages, nativeApp: "yes" as never }).nativeApp).toBe(false);
  });
});
