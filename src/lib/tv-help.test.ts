import { describe, expect, it } from "vitest";
import { CLEAN_TV_HELP_NOTE, isTvHelp, isTvHelpChat } from "./tv-help";

describe("TV and app help is answered clean", () => {
  it("spots TV and app help asks", () => {
    for (const ask of [
      "how do I set up my firestick?",
      "Fire TV keeps buffering",
      "what's the downloader code for og vault",
      "my iptv isn't working",
      "tivimate login help",
      "how do I install an apk on android tv",
      "the app won't open on my tv",
      "channels keep freezing",
      "how to get a vault pass",
    ])
      expect(isTvHelp(ask), ask).toBe(true);
  });

  it("leaves ordinary chat alone", () => {
    for (const chat of [
      "roast my mate dave",
      "watching tv tonight lol",
      "make me a drill song about london",
      "what's gold doing",
      "",
    ])
      expect(isTvHelp(chat), chat).toBe(false);
  });

  it("a follow-up right after a TV help ask stays clean", () => {
    expect(isTvHelpChat(["my firestick won't load", "still not working"])).toBe(true);
    expect(isTvHelpChat(["roast me", "still not working"])).toBe(false);
    expect(isTvHelpChat(["my firestick won't load", "anyway roast dave"])).toBe(false);
  });

  it("every chat reply gets the clean note and no foul mouth for TV help", async () => {
    const { cleanForTvHelp } = await import("./ai-endpoint.server");
    const body = {
      messages: [
        { role: "system", content: "You are OG B0T, savage." },
        { role: "user", content: "how do I install og vault on my firestick" },
      ],
    };
    const out = cleanForTvHelp(body, { foulMouth: true, freeOnly: true });
    expect(out.tvHelp).toBe(true);
    expect(out.opts).toEqual({ foulMouth: false, freeOnly: true });
    const sys = (out.body.messages as { content: string }[])[0].content;
    expect(sys).toContain("You are OG B0T, savage.");
    expect(sys).toContain(CLEAN_TV_HELP_NOTE);

    const roast = { messages: [{ role: "user", content: "roast dave" }] };
    const same = cleanForTvHelp(roast, { foulMouth: true });
    expect(same).toEqual({ body: roast, opts: { foulMouth: true }, tvHelp: false });

    // Text-and-image messages and no system prompt.
    const pic = {
      messages: [{ role: "user", content: [{ type: "text", text: "fire stick error, help" }] }],
    };
    const cleaned = cleanForTvHelp(pic, { foulMouth: true });
    expect((cleaned.body.messages as { role: string }[])[0]).toEqual({
      role: "system",
      content: CLEAN_TV_HELP_NOTE,
    });
  });
});
