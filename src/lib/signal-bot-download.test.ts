import { describe, expect, it } from "vitest";
import { cleanDownloadUrl, DOWNLOAD_URL_KEY, memberConfig } from "./copier-keys";
import { downloadUrl, setDownloadUrl, tokenPass } from "./copier-keys.server";

/** site_content rows, one store item and the audit log. */
function fakeDb(item: Record<string, unknown> | null = null) {
  const rows = new Map<string, string>();
  const from = (table: string) => {
    const f: { eq?: unknown } = {};
    const q = {
      select: () => q,
      eq: (_c: string, v: unknown) => ((f.eq = v), q),
      maybeSingle: async () => {
        if (table === "store_items") return { data: item };
        const v = rows.get(String(f.eq));
        return { data: v == null ? null : { value: v } };
      },
      upsert: async (r: { key: string; value: string }) => (
        rows.set(r.key, r.value),
        { error: null }
      ),
      insert: () => Promise.resolve({}),
    };
    return q;
  };
  return { db: { from }, rows };
}

describe("the OG SIGNAL BOT zip and passes", () => {
  it("only an https link is shown as the download", () => {
    expect(cleanDownloadUrl("https://pub-x.r2.dev/OG-SIGNAL-BOT.zip")).toBe(
      "https://pub-x.r2.dev/OG-SIGNAL-BOT.zip",
    );
    expect(cleanDownloadUrl("http://x.com/a.zip")).toBeNull();
    expect(cleanDownloadUrl("javascript:alert(1)")).toBeNull();
    expect(cleanDownloadUrl("")).toBeNull();
  });

  it("the Boss saves the link, members get it; an empty link clears it", async () => {
    const { db, rows } = fakeDb();
    expect(await downloadUrl(db)).toBeNull();
    expect((await setDownloadUrl(db, "boss", "ftp://nope")).ok).toBe(false);
    expect((await setDownloadUrl(db, "boss", "https://cdn.example.com/bot.zip")).ok).toBe(true);
    expect(await downloadUrl(db)).toBe("https://cdn.example.com/bot.zip");
    expect((await setDownloadUrl(db, "boss", "")).message).toMatch(/cleared/);
    expect(rows.get(DOWNLOAD_URL_KEY)).toBe("");
    expect(await downloadUrl(db)).toBeNull();
  });

  it("the pass on sale: its price, its days, and whether it's free", async () => {
    const item = {
      id: "5909b4b0-225d-478d-8b39-0d576cf870c2",
      price_cents: 2999,
      coin_price: null,
      currency: "gbp",
      perk_slug: "signal_token",
      active: true,
    };
    expect(await tokenPass(fakeDb(item).db)).toEqual({
      itemId: item.id,
      priceCents: 2999,
      currency: "gbp",
      days: 30,
      free: false,
    });
    expect((await tokenPass(fakeDb({ ...item, price_cents: 0 }).db))?.free).toBe(true);
    expect(await tokenPass(fakeDb({ ...item, active: false }).db)).toBeNull();
    expect(await tokenPass(fakeDb(null).db)).toBeNull();
  });

  it("config.ini needs no editing: token in, live trading on", () => {
    const cfg = memberConfig("ogk_abc");
    expect(cfg).toContain("token = ogk_abc");
    expect(cfg).toContain("dry_run = false");
    expect(cfg).toContain("feed_url = https://ogbot.co.uk/api/public/copy-feed");
  });
});
