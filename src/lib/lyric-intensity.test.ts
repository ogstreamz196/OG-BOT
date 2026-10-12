import { describe, expect, it } from "vitest";
import { lyricIntensityIssue } from "../../supabase/functions/_shared/lyric-intensity";

describe("lyric intensity quality gate", () => {
  it("rejects soft and repetitive Savage output", () => {
    expect(lyricIntensityIssue("[Verse]\nYou muppet, what a clown\nYou melt around town", 3, true)).toBeTruthy();
    expect(lyricIntensityIssue("Fucking one\nFucking two\nFucking three", 3, true)).toBeTruthy();
  });
  it("accepts varied hard profanity throughout Savage", () => {
    expect(lyricIntensityIssue("[Verse]\nFucking late again\nYou dickhead missed the train\nBastard stole my seat\nWanker in the street\nThe story carries on", 3, true)).toBeNull();
  });
  it("keeps Clean and Mild distinct from Strong", () => {
    expect(lyricIntensityIssue("Clean song about the station", 0, true)).toBeNull();
    expect(lyricIntensityIssue("Fucking late", 0, true)).toBeTruthy();
    expect(lyricIntensityIssue("Bloody late\nDamn train", 1, true)).toBeNull();
    expect(lyricIntensityIssue("Fucking late", 1, true)).toBeTruthy();
    expect(lyricIntensityIssue("Fucking late\nTrain arrived\nSeat by the door\nNight carries on\nHome once more", 2, true)).toBeNull();
  });
  it("never requires English swears in other selected languages", () => {
    expect(lyricIntensityIssue("Other language lyrics", 3, false)).toBeNull();
  });
});