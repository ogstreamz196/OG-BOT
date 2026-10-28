// Buying OG coins straight from Telegram: OG B0T lists the coin packs (with
// the Boss's price/coin overrides), a tap makes a Stripe Checkout page for
// that member, and the Stripe webhook credits the coins exactly as it does for
// the website (creditCoinsForSession, same metadata), then OG B0T confirms the
// new balance in Telegram (source "telegram").
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  COIN_PACKS,
  CURRENCY_SYMBOL,
  applyPackOverride,
  findCoinPackByBundleId,
  packOverrideKey,
  parsePackOverride,
  type CoinPack,
} from "@/lib/coin-packs";

type Admin = SupabaseClient<Database>;

/** The coin packs as members see them on the site, Boss overrides applied. */
export async function telegramCoinPacks(admin: Admin): Promise<CoinPack[]> {
  const keys = COIN_PACKS.map((p) => packOverrideKey(p.bundleId));
  const { data } = await admin.from("site_content").select("key, value").in("key", keys);
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value as string | null]));
  return COIN_PACKS.map((p) =>
    applyPackOverride(p, parsePackOverride(byKey.get(packOverrideKey(p.bundleId)))),
  );
}

export const packPrice = (pack: CoinPack) =>
  `${CURRENCY_SYMBOL}${(pack.priceCents / 100).toFixed(2)}`;

/** One button per pack: "🪙 100 coins · £9.99". */
export function coinPackButtons(packs: CoinPack[]) {
  return packs.map((p) => [
    { text: `🪙 ${p.coins} coins · ${packPrice(p)}`, callback_data: `buy:${p.bundleId}` },
  ]);
}

let botUsername: string | null | undefined;
async function backToBotUrl(): Promise<string> {
  if (botUsername === undefined) {
    const { telegramCall } = await import("@/lib/telegram-api.server");
    const me = await telegramCall<{ username?: string }>("getMe", {});
    botUsername = me?.username ?? null;
  }
  return botUsername ? `https://t.me/${botUsername}` : "https://ogbot.co.uk/store";
}

export type TelegramCheckout = { url: string; pack: CoinPack } | { error: string };

/** A Stripe Checkout page for one coin pack, paid for by this member. */
export async function createTelegramCoinCheckout(
  admin: Admin,
  userId: string,
  bundleId: string,
): Promise<TelegramCheckout> {
  const base = findCoinPackByBundleId(bundleId);
  if (!base) return { error: "That pack doesn't exist any more." };
  const { serverStripeEnv } = await import("@/lib/vip-promo.server");
  const env = serverStripeEnv();
  if (!env) return { error: "Card payments aren't switched on right now." };
  try {
    const pack = (await telegramCoinPacks(admin)).find((p) => p.bundleId === base.bundleId)!;
    const { createStripeClient } = await import("@/lib/stripe.server");
    const { resolveOrCreateCustomer } = await import("@/lib/payments.functions");
    const stripe = createStripeClient(env);
    const prices = await stripe.prices.list({ lookup_keys: [base.priceId] });
    const stripePrice = prices.data[0];
    if (!stripePrice) return { error: "That pack isn't on sale right now." };
    const { data: prof } = await admin
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    const customer = await resolveOrCreateCustomer(stripe, {
      email: prof?.email ?? undefined,
      userId,
    });
    const productId =
      typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
    // A Boss price change can't reuse the catalogue price (fixed amount).
    const priceChanged = pack.priceCents !== base.priceCents;
    const lineItem = priceChanged
      ? {
          price_data: { currency: base.currency, unit_amount: pack.priceCents, product: productId },
          quantity: 1,
        }
      : { price: stripePrice.id, quantity: 1 };
    const meta = { userId, bundleId: pack.bundleId, coins: String(pack.coins) };
    const back = await backToBotUrl();
    const session = await stripe.checkout.sessions.create({
      line_items: [lineItem],
      mode: "payment",
      success_url: back,
      cancel_url: back,
      customer,
      payment_intent_data: {
        description: `${pack.label} · ${pack.coins} OG Coins`,
        metadata: meta,
      },
      metadata: {
        ...meta,
        environment: env,
        source: "telegram",
        ...(priceChanged ? { priceOverridden: "1" } : {}),
      },
    });
    if (!session.url) return { error: "Stripe didn't give a payment page. Try again." };
    return { url: session.url, pack };
  } catch (error) {
    console.error("[telegram] coin checkout failed", error);
    return { error: "Couldn't open the payment page. Try again in a minute." };
  }
}

/** After the webhook credits a Telegram purchase: tell them in Telegram. */
export async function confirmTelegramCoins(
  admin: Admin,
  userId: string,
  coins: number,
  balance: number,
): Promise<void> {
  const { data: prof } = await admin
    .from("profiles")
    .select("telegram_chat_id")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.telegram_chat_id) return;
  const { telegramApi } = await import("@/lib/telegram-api.server");
  await telegramApi("sendMessage", {
    chat_id: prof.telegram_chat_id,
    text: `✅ <b>Paid up, legend.</b> ${coins} OG coins just landed.\n💰 Balance: <b>${balance}</b> OG coins`,
    parse_mode: "HTML",
  });
}
