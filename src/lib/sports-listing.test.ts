import { describe, expect, it } from "vitest";
import { dedupe, parseListing, searchListing } from "./sports-listing";

const dazn = {
  id: "1",
  telegram_message_id: 5,
  posted_at: "2026-10-05T10:38:19Z",
  raw_text:
    "DAZN CA 05.10.2026\n\nDAZN CA 01: Italy vs. Türkiye 10-05 19:45 GMT\nDAZN CA 07: Falcons @ Saints 10-06 01:15 GMT\nDAZN CA 06: Final | Indonesia vs. Thailand 10-05 14:00 GMT",
};
const promo = {
  id: "2",
  telegram_message_id: 6,
  posted_at: "2026-10-05T21:42:56Z",
  raw_text: "⚽️NEW SPORTS GUIDE BOT.\nVisit 👇\nhttps://ogbot.co.uk/r/OGB1GB0SS",
};

describe("sports listings (real channel formats)", () => {
  it("parses channel, event and GMT time", () => {
    const l = parseListing(dazn);
    expect(l.title).toBe("DAZN CA");
    expect(l.fixtures).toHaveLength(3);
    expect(l.fixtures[0]).toMatchObject({ channel: "DAZN CA 01", event: "Italy vs. Türkiye" });
    expect(l.fixtures[0].at?.toISOString()).toBe("2026-10-05T19:45:00.000Z");
    expect(l.fixtures[2].event).toBe("Final | Indonesia vs. Thailand");
  });
  it("keeps promo posts as plain notes", () => {
    const l = parseListing(promo);
    expect(l.fixtures).toHaveLength(0);
    expect(l.notes.length).toBe(3);
  });
  it("search narrows to matching fixtures", () => {
    const l = parseListing(dazn);
    expect(searchListing(l, ["italy"])?.fixtures.map((f) => f.channel)).toEqual(["DAZN CA 01"]);
    expect(searchListing(l, ["dazn"])?.fixtures).toHaveLength(3);
    expect(searchListing(l, ["arsenal"])).toBeNull();
  });
  it("dedupes reposted listings", () => {
    expect(dedupe([dazn, { ...dazn, id: "3" }, promo])).toHaveLength(2);
  });
  it("parses Paramount line", () => {
    const l = parseListing({
      ...dazn,
      raw_text:
        "Paramount US 05.10.2026\n\nParaUS 04: Serie A: Genoa vs. Fiorentina 10-10 13:50 GMT",
    });
    expect(l.fixtures[0]).toMatchObject({
      channel: "ParaUS 04",
      event: "Serie A: Genoa vs. Fiorentina",
    });
  });
  it("parses EPL/EFL lines (kick-off between the teams, UK time)", () => {
    const l = parseListing({
      ...dazn,
      posted_at: "2026-10-24T08:41:20Z",
      raw_text:
        "⚽ EPL Events ⚽\n\nEPL01: Liverpool 14:00 Brighton 25/10\nEPL05: Sunderland 16:30 Leeds 24/10\n\n• Sent via TeleFeed",
    });
    expect(l.title).toBe("EPL Events");
    expect(l.notes).toEqual([]);
    expect(l.fixtures[0]).toMatchObject({ channel: "EPL01", event: "Liverpool vs Brighton" });
    // 25 Oct 2026: the clocks have gone back, so UK 14:00 is 14:00 GMT.
    expect(l.fixtures[0].at?.toISOString()).toBe("2026-10-25T14:00:00.000Z");
    // 24 Oct 2026 is still BST: UK 16:30 is 15:30 GMT.
    expect(l.fixtures[1].at?.toISOString()).toBe("2026-10-24T15:30:00.000Z");
    const efl = parseListing({ ...dazn, raw_text: "EFL01: (L2) Walsall 20:00 Salford 26/10" });
    expect(efl.fixtures[0]).toMatchObject({ channel: "EFL01", event: "L2: Walsall vs Salford" });
    expect(searchListing(efl, ["walsall"])?.fixtures).toHaveLength(1);
  });
  it("names a listing carried on in a second post after its channel", () => {
    const l = parseListing({
      ...dazn,
      raw_text:
        "FloSports 311: flograppling: Rei do Rio (Rei do Rio) 10-24 13:00 GMT\nFloSports 312: flofc: Hofstra vs Drexel (Hofstra vs Drexel 2) 10-24 18:00 GMT",
    });
    expect(l.title).toBe("FloSports");
    expect(l.fixtures).toHaveLength(2);
    expect(l.notes).toEqual([]);
    expect(l.fixtures[0].event).toBe("flograppling: Rei do Rio");
    expect(l.fixtures[1].event).toBe("flofc: Hofstra vs Drexel (Hofstra vs Drexel 2)");
  });
  it("puts January fixtures posted in December in the new year", () => {
    const l = parseListing({
      ...dazn,
      posted_at: "2026-12-31T12:00:00Z",
      raw_text: "DAZN UK 31.12.2026\nDAZN UK 01: Boxing 01-01 01:00 GMT",
    });
    expect(l.fixtures[0].at?.toISOString()).toBe("2027-01-01T01:00:00.000Z");
  });
});
