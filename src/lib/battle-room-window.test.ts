import { describe, expect, test } from "vitest";
import { crewNote, ROOM_WINDOW_MS } from "./telegram-group-battle.server";
import { roomSince } from "./community.functions";

const NOW = Date.parse("2026-11-01T00:12:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const line = (name: string, content: string, min: number) => ({
  role: "user" as const,
  name,
  content,
  created_at: ago(min),
});

describe("only people in the room now get roasted together", () => {
  test("a newcomer alone isn't ganged up with people from an hour ago", () => {
    const note = crewNote(
      [
        line("zeeshan", "testicles", 55),
        line("OGB1GB0SS", "btc signal", 40),
        line("Grotty Haddock", "Hi how are you", 0),
      ],
      "Grotty Haddock",
      NOW,
    );
    expect(note).not.toMatch(/GANGING UP/);
    expect(note).not.toMatch(/zeeshan|OGB1GB0SS/);
  });

  test("two people battling at the same time still get the pile-on note", () => {
    const note = crewNote(
      [line("zeeshan", "you muppet", 3), line("Grotty Haddock", "you're trash", 0)],
      "Grotty Haddock",
      NOW,
    );
    expect(note).toMatch(/GANGING UP on you \(zeeshan, Grotty Haddock\)/);
  });

  test("the room is the last ten minutes", () => {
    expect(ROOM_WINDOW_MS).toBe(10 * 60_000);
    expect(roomSince(NOW)).toBe(ago(10));
  });
});
