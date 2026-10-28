import { describe, expect, it, vi } from "vitest";

const created: Record<string, unknown>[] = [];
vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: () => ({
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: [{ id: `price_${lookup_keys[0]}`, product: "prod_1" }],
      }),
    },
    checkout: {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          created.push(args);
          return { url: "https://checkout.stripe.com/c/pay/x" };
        },
      },
    },
  }),
}));
vi.mock("@/lib/payments.functions", () => ({ resolveOrCreateCustomer: async () => "cus_1" }));
vi.mock("@/lib/vip-promo.server", () => ({ serverStripeEnv: () => "sandbox" }));
vi.mock("@/lib/telegram-api.server", () => ({
  telegramCall: async () => ({ username: "OGB0T_bot" }),
}));

import {
  coinPackButtons,
  createTelegramCoinCheckout,
  telegramCoinPacks,
} from "./telegram-coins.server";

function fakeAdmin(overrides: Record<string, string>) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = async () => ({
        data: Object.entries(overrides).map(([key, value]) => ({ key, value })),
      });
      q.maybeSingle = async () => ({ data: table === "profiles" ? { email: "a@b.c" } : null });
      return q;
    },
  } as never;
}

describe("Telegram coin packs", () => {
  it("lists every pack with the Boss's overrides", async () => {
    const packs = await telegramCoinPacks(
      fakeAdmin({ "buyCoins.pack.coins_100": JSON.stringify({ coins: 120 }) }),
    );
    const buttons = coinPackButtons(packs).flat();
    expect(buttons.map((b) => b.callback_data)).toEqual([
      "buy:coins_50",
      "buy:coins_100",
      "buy:coins_240",
      "buy:coins_600",
    ]);
    expect(buttons[1].text).toBe("🪙 120 coins · £9.99");
  });

  it("makes a checkout the payments webhook will credit, back to the bot after", async () => {
    created.length = 0;
    const res = await createTelegramCoinCheckout(fakeAdmin({}), "user-1", "coins_240");
    expect(res).toMatchObject({ url: "https://checkout.stripe.com/c/pay/x" });
    const s = created[0] as {
      metadata: Record<string, string>;
      success_url: string;
      line_items: unknown[];
    };
    expect(s.metadata).toMatchObject({
      userId: "user-1",
      bundleId: "coins_240",
      coins: "240",
      environment: "sandbox",
      source: "telegram",
    });
    expect(s.success_url).toBe("https://t.me/OGB0T_bot");
    expect(s.line_items).toEqual([{ price: "price_coins_240_gbp", quantity: 1 }]);
  });

  it("charges the Boss's changed price", async () => {
    created.length = 0;
    await createTelegramCoinCheckout(
      fakeAdmin({ "buyCoins.pack.coins_50": JSON.stringify({ priceCents: 399 }) }),
      "user-1",
      "coins_50",
    );
    expect((created[0] as { line_items: unknown[] }).line_items).toEqual([
      { price_data: { currency: "gbp", unit_amount: 399, product: "prod_1" }, quantity: 1 },
    ]);
  });

  it("refuses unknown packs", async () => {
    expect(await createTelegramCoinCheckout(fakeAdmin({}), "u", "coins_9999")).toHaveProperty(
      "error",
    );
  });
});
