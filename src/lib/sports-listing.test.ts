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
    const l = parseListing({ ...dazn, raw_text: "Paramount US 05.10.2026\n\nParaUS 04: Serie A: Genoa vs. Fiorentina 10-10 13:50 GMT" });
    expect(l.fixtures[0]).toMatchObject({ channel: "ParaUS 04", event: "Serie A: Genoa vs. Fiorentina" });
  });
});
