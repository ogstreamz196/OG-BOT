// Server-only: personal single-use £10-off Yearly VIP promo codes handed out
// by OG Bot in private chat (app + Telegram). Each user gets ONE code per
// Stripe environment; it never expires and burns after one redemption.
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

type AnyClient = { from: (t: string) => any };

const COUPON_ID = "og_vip_yearly_10_off";
const DISCOUNT_PENCE = 1000;

// Many ways of asking: promo / discount / coupon / voucher / deal / cheaper...
const PROMO_RE =
  /\b(promo(tion)?s?(\s*code)?|discount(s|ed)?|coupons?|vouchers?|codes?\s+for\s+vip|vip\s+code|cheaper|money\s*off|£\s*\d+\s*off|\d+\s*%\s*off|deal|offer|hook\s*(me|us)\s*up|sort\s*me\s*out|bargain|price\s*drop|reduce\s+the\s+price|lower\s+(the\s+)?price)\b/i;

export function detectPromoIntent(text: string | null | undefined): boolean {
  if (!text) return false;
  return PROMO_RE.test(text);
}

export function serverStripeEnv(): StripeEnv | null {
  const pk =
    (import.meta.env?.["VITE_STRIPE_PUBLISHABLE_KEY"] as string | undefined) ??
    process.env["VITE_STRIPE_PUBLISHABLE_KEY"];
  if (pk?.startsWith("pk_live_")) return "live";
  if (pk?.startsWith("pk_test_")) return "sandbox";
  return null;
}

async function ensureCoupon(stripe: ReturnType<typeof createStripeClient>) {
  try {
    await stripe.coupons.retrieve(COUPON_ID);
    return;
  } catch {
    /* create below */
  }
  let productId: string | undefined;
  try {
    const prices = await stripe.prices.list({ lookup_keys: ["og_vip_yearly"], active: true });
    const p = prices.data[0]?.product;
    productId = typeof p === "string" ? p : p?.id;
  } catch {
    /* restriction optional */
  }
  await stripe.coupons.create({
    id: COUPON_ID,
    name: "OG Bot secret £10 off Yearly VIP",
    amount_off: DISCOUNT_PENCE,
    currency: "gbp",
    duration: "once",
    ...(productId ? { applies_to: { products: [productId] } } : {}),
  });
}

function randomSuffix(n = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export type PromoResult =
  | { status: "issued" | "existing"; code: string }
  | { status: "redeemed"; code: string }
  | { status: "already_vip" }
  | { status: "unavailable"; reason: string };

/** Returns the user's personal code, creating it in Stripe on first ask. */
export async function getOrCreateVipPromo(
  admin: AnyClient,
  userId: string,
  opts: { isPaidVip: boolean },
): Promise<PromoResult> {
  if (opts.isPaidVip) return { status: "already_vip" };
  const env = serverStripeEnv();
  if (!env) return { status: "unavailable", reason: "payments offline" };

  const { data: row } = await admin
    .from("vip_promo_codes")
    .select("code, stripe_promotion_code_id, redeemed_at")
    .eq("user_id", userId)
    .eq("environment", env)
    .maybeSingle();

  const stripe = createStripeClient(env);

  if (row) {
    if (row.redeemed_at) return { status: "redeemed", code: row.code };
    try {
      const pc = await stripe.promotionCodes.retrieve(row.stripe_promotion_code_id);
      if ((pc.times_redeemed ?? 0) >= 1 || !pc.active) {
        await admin
          .from("vip_promo_codes")
          .update({ redeemed_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("environment", env);
        return { status: "redeemed", code: row.code };
      }
    } catch {
      /* fall through: still show stored code */
    }
    return { status: "existing", code: row.code };
  }

  try {
    await ensureCoupon(stripe);
    const { data: prof } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    const name = String(prof?.display_name ?? "OG")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10) || "OG";
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      const code = `OG-VIP-${name}-${randomSuffix()}`;
      try {
        const pc = await stripe.promotionCodes.create({
          promotion: { type: "coupon", coupon: COUPON_ID },
          code,
          max_redemptions: 1,
          metadata: { userId, source: "og_bot_private_chat" },
        });
        const { error } = await admin.from("vip_promo_codes").insert({
          user_id: userId,
          environment: env,
          code,
          stripe_promotion_code_id: pc.id,
        });
        if (error) {
          // Lost a race with a parallel request — deactivate ours, return theirs.
          await stripe.promotionCodes.update(pc.id, { active: false }).catch(() => {});
          const { data: again } = await admin
            .from("vip_promo_codes")
            .select("code")
            .eq("user_id", userId)
            .eq("environment", env)
            .maybeSingle();
          if (again?.code) return { status: "existing", code: again.code };
          throw new Error(error.message);
        }
        return { status: "issued", code };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  } catch (e) {
    console.error("vip promo create failed", e);
    return { status: "unavailable", reason: (e as Error).message };
  }
}

/** Extra system-prompt block so OG Bot replies in character with the facts. */
export function promoPromptNote(r: PromoResult): string {
  const how =
    "To use it: open the Store (ogbot.co.uk/store), pick VIP Yearly, pay by card and tap 'Add promotion code' on the payment screen. Price drops from £50 to £40 for the first year.";
  switch (r.status) {
    case "issued":
      return `\n\nPROMO CODE (just created for this user — you MUST include it exactly): ${r.code}. £10 off Yearly VIP, single-use, never expires until used, locked to them. ${how} Hype it up in character, tell them not to share it.`;
    case "existing":
      return `\n\nPROMO CODE: this user already has an unused personal code: ${r.code}. Remind them (include it exactly), say it's still waiting until they use it, only one per person. ${how}`;
    case "redeemed":
      return `\n\nPROMO CODE: this user already used their one-time code (${r.code}). Tell them in character it's burnt — one per person, no more codes.`;
    case "already_vip":
      return `\n\nPROMO CODE: user is already a paid VIP, so no discount code — tell them they're already eating good.`;
    default:
      return `\n\nPROMO CODE: the code machine is offline right now; tell them to try again a bit later.`;
  }
}

/** Guarantees the exact code reaches the user even if the AI paraphrases. */
export function ensureCodeInReply(reply: string, r: PromoResult): string {
  if ((r.status === "issued" || r.status === "existing") && !reply.includes(r.code)) {
    return `${reply}\n\n🎫 Your code: **${r.code}** — £10 off Yearly VIP (£50 → £40). Single-use, never expires. Add it at checkout via "Add promotion code".`;
  }
  return reply;
}
