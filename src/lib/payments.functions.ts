import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import {
  findCoinPackByPriceId,
  findCoinPackByBundleId,
  isVipBundle,
  getVipPlan,
  VIP_PLAN,
  CUSTOM_COIN_UNIT,
  applyPackOverride,
  parsePackOverride,
  packOverrideKey,
} from "@/lib/coin-packs";

type CheckoutSessionResult = { clientSecret: string } | { error: string };

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  if (options.userId) {
    try {
      const found = await stripe.customers.search({
        query: `metadata['userId']:'${options.userId}'`,
        limit: 1,
      });
      if (found?.data?.length) return found.data[0].id;
    } catch (err) {
      // Stripe search index may not be available yet for newly-created customers,
      // or the API key may lack search permissions. Fall back to email lookup.
      console.warn("stripe.customers.search failed, falling back", err);
    }
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing?.data?.length) {
      const customer = existing.data[0];
      if (options.userId && customer.metadata?.userId !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

export const createCoinCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { priceId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
    const pack = findCoinPackByPriceId(data.priceId);
    if (!pack) throw new Error("Unknown coin pack");
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (!/^https?:\/\//.test(data.returnUrl)) throw new Error("Invalid returnUrl");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    const { userId, supabase } = context;
    try {
      const basePack = findCoinPackByPriceId(data.priceId)!;
      const stripe = createStripeClient(data.environment);

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0];

      // Read server-side admin override (label / desc / coins / price / bonus).
      // The override row is only writable via the set_site_content RPC, which
      // is gated to admin/dev — so trusting these values here is safe.
      let override = parsePackOverride(null);
      try {
        const { data: row } = await supabase
          .from("site_content")
          .select("value")
          .eq("key", packOverrideKey(basePack.bundleId))
          .maybeSingle();
        override = parsePackOverride(row?.value);
      } catch {
        /* override is best-effort; fall back to canonical pack */
      }

      const pack = applyPackOverride(basePack, override);
      const priceChanged = pack.priceCents !== basePack.priceCents;

      // Best-effort email lookup for receipt + Customer linking.
      let email: string | undefined;
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .maybeSingle();
        email = (prof?.email as string | undefined) ?? undefined;
      } catch {
        /* email is optional */
      }

      const customerId = await resolveOrCreateCustomer(stripe, { email, userId });

      const productId =
        typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
      const product = await stripe.products.retrieve(productId);
      const productDescription =
        pack.label !== basePack.label ? `${pack.label} · ${pack.coins} OG Coins` : product.name;

      // When the admin has changed the price, we cannot reuse the catalog
      // price id (its unit_amount is fixed). Build a one-off price_data
      // line pointing at the same Stripe Product so receipts and the
      // dashboard still resolve the right product name.
      const lineItem = priceChanged
        ? {
            price_data: {
              currency: basePack.currency,
              unit_amount: pack.priceCents,
              product: productId,
            },
            quantity: 1,
          }
        : { price: stripePrice.id, quantity: 1 };

      const session = await stripe.checkout.sessions.create({
        line_items: [lineItem],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        payment_intent_data: {
          description: productDescription,
          metadata: {
            userId,
            bundleId: pack.bundleId,
            coins: String(pack.coins),
          },
        },
        metadata: {
          userId,
          bundleId: pack.bundleId,
          coins: String(pack.coins),
          environment: data.environment,
          ...(priceChanged ? { priceOverridden: "1" } : {}),
        },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      console.error("createCoinCheckoutSession failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createVipCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: {
      returnUrl: string;
      environment: StripeEnv;
      plan?: "monthly" | "yearly";
      noAutoRenew?: boolean;
    }) => {
      if (data.environment !== "sandbox" && data.environment !== "live") {
        throw new Error("Invalid environment");
      }
      if (!/^https?:\/\//.test(data.returnUrl)) throw new Error("Invalid returnUrl");
      if (data.plan !== undefined && data.plan !== "monthly" && data.plan !== "yearly") {
        throw new Error("Invalid plan");
      }
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    const { userId, supabase } = context;
    const plan = getVipPlan(data.plan);
    try {
      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [plan.priceId], active: true });
      if (!prices.data.length) throw new Error("VIP price not found");
      const stripePrice = prices.data[0];

      let email: string | undefined;
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .maybeSingle();
        email = (prof?.email as string | undefined) ?? undefined;
      } catch {
        /* email optional */
      }

      const customerId = await resolveOrCreateCustomer(stripe, { email, userId });

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        allow_promotion_codes: true,
        metadata: {
          userId,
          bundleId: plan.bundleId,
          environment: data.environment,
          ...(data.noAutoRenew && data.plan === "yearly" ? { noAutoRenew: "1" } : {}),
        },
        subscription_data: {
          metadata: {
            userId,
            bundleId: plan.bundleId,
            ...(data.noAutoRenew && data.plan === "yearly" ? { noAutoRenew: "1" } : {}),
          },
        },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      console.error("createVipCheckoutSession failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createCustomCoinCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { units: number; returnUrl: string; environment: StripeEnv }) => {
    if (!Number.isInteger(data.units)) throw new Error("Invalid units");
    if (data.units < CUSTOM_COIN_UNIT.minUnits || data.units > CUSTOM_COIN_UNIT.maxUnits) {
      throw new Error(
        `Units must be between ${CUSTOM_COIN_UNIT.minUnits} and ${CUSTOM_COIN_UNIT.maxUnits}`,
      );
    }
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (!/^https?:\/\//.test(data.returnUrl)) throw new Error("Invalid returnUrl");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    const { userId, supabase } = context;
    try {
      const stripe = createStripeClient(data.environment);
      const coins = data.units * CUSTOM_COIN_UNIT.coins;

      let email: string | undefined;
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .maybeSingle();
        email = (prof?.email as string | undefined) ?? undefined;
      } catch {
        /* optional */
      }

      const customerId = await resolveOrCreateCustomer(stripe, { email, userId });

      const description = `${coins} OG Coins (Custom)`;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Use quantity = units so Stripe Checkout shows the line as
            // "<units> × £0.99" (per-unit pricing) instead of a single
            // opaque amount. The total still equals units * priceCents.
            price_data: {
              currency: "gbp",
              product_data: {
                name: `${CUSTOM_COIN_UNIT.coins}-coin top-up`,
                description: `Each unit = ${CUSTOM_COIN_UNIT.coins} OG Coins`,
              },
              unit_amount: CUSTOM_COIN_UNIT.priceCents,
            },
            quantity: data.units,
          },
        ],

        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        payment_intent_data: {
          description,
          metadata: {
            userId,
            bundleId: "coins_custom",
            coins: String(coins),
          },
        },
        metadata: {
          userId,
          bundleId: "coins_custom",
          coins: String(coins),
          environment: data.environment,
        },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      console.error("createCustomCoinCheckoutSession failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

// -------------------------------------------------------------------------
// Reconcile: when the webhook hasn't credited yet (delivery delay, missed
// retry, etc.), the return page calls this with the Stripe session_id to
// credit coins on-demand. Idempotent: uses the same `reference` key as
// the webhook so it can run safely alongside it.
// -------------------------------------------------------------------------

type ReconcileResult =
  | { status: "credited"; coins: number; balance: number }
  | { status: "already_credited"; coins: number; balance: number }
  | { status: "vip_granted"; ogVipId?: string | null }
  | { status: "pending"; reason: string }
  | { status: "store_item" }
  | { error: string };

export const reconcileCoinSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { sessionId: string; environment: StripeEnv }) => {
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(data.sessionId)) throw new Error("Invalid sessionId");
    if (data.environment !== "sandbox" && data.environment !== "live")
      throw new Error("Invalid environment");
    return data;
  })
  .handler(async ({ data, context }): Promise<ReconcileResult> => {
    const { userId } = context;
    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);

      const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
      if (meta.userId !== userId) {
        return { error: "Session does not belong to this user" };
      }
      if (
        session.status !== "complete" ||
        (session.payment_status &&
          session.payment_status !== "paid" &&
          session.payment_status !== "no_payment_required")
      ) {
        return { status: "pending", reason: session.payment_status ?? session.status ?? "unknown" };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const bundleId = meta.bundleId;

      // VIP subscription path
      if (bundleId && isVipBundle(bundleId)) {
        const { error } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: userId, role: "vip" }, { onConflict: "user_id,role" });
        if (error) return { error: error.message };
        let ogVipId: string | null = null;
        if (/year/i.test(bundleId)) {
          const { data: id, error: idErr } = await (supabaseAdmin as any).rpc("assign_og_vip_id", {
            p_user: userId,
          });
          if (idErr) console.error("assign_og_vip_id failed", idErr);
          else ogVipId = (id as string | null) ?? null;
          try {
            const { queueYearlyVipAck } = await import("@/lib/vip-ack.server");
            await queueYearlyVipAck(supabaseAdmin, userId, ogVipId);
          } catch (e) {
            console.error("vip ack notify failed", e);
          }
        }
        return { status: "vip_granted", ogVipId };
      }

      // Store items (Vault pass, perks, coin-reward items) are fulfilled once by
      // the webhook under its own reference; crediting here as well would pay
      // twice, and items without coins would wrongly report an error.
      if (bundleId?.startsWith("store:")) return { status: "store_item" };

      const metaCoins = meta.coins ? Number(meta.coins) : 0;
      const pack = bundleId ? findCoinPackByBundleId(bundleId) : null;
      const coins = Number.isFinite(metaCoins) && metaCoins > 0 ? metaCoins : (pack?.coins ?? 0);
      if (!coins || coins <= 0) return { error: "Could not determine coin amount" };

      const reference = `stripe:${data.environment}:${session.id}`;
      const { data: result, error: creditErr } = await (supabaseAdmin as any).rpc(
        "credit_coin_transaction",
        {
          _user_id: userId,
          _amount: coins,
          _type: "stripe_purchase",
          _reference: reference,
        },
      );
      if (creditErr) return { error: creditErr.message };

      const balance = Number((result as { balance?: number } | null)?.balance ?? 0);
      const credited = Boolean((result as { credited?: boolean } | null)?.credited);
      // No referral reward on card payments (owner rule; see AGENTS.md).
      return credited
        ? { status: "credited", coins, balance }
        : { status: "already_credited", coins, balance };
    } catch (error) {
      console.error("reconcileCoinSession failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

// -------------------------------------------------------------------------
// One-off card unlock: pay 99p for a single track instead of spending coins.
// -------------------------------------------------------------------------

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export const createTrackUnlockCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { songId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!UUID_RE.test(data.songId)) throw new Error("Invalid songId");
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (!/^https?:\/\//.test(data.returnUrl)) throw new Error("Invalid returnUrl");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    const { userId, supabase } = context;
    try {
      const { TRACK_UNLOCK_PENCE, TRACK_UNLOCK_CURRENCY } =
        await import("@/lib/track-unlock.server");
      const stripe = createStripeClient(data.environment);

      const { data: song } = await supabase
        .from("songs")
        .select("id, title, status")
        .eq("id", data.songId)
        .maybeSingle();
      if (!song) return { error: "Track not found" };
      if (song.status !== "completed") return { error: "Track is not ready yet" };
      const { trackCardQuantity, songIsNasheed } = await import("@/lib/nasheed");
      const nasheed = await songIsNasheed(supabase, data.songId);

      let email: string | undefined;
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .maybeSingle();
        email = (prof?.email as string | undefined) ?? undefined;
      } catch {
        /* email is optional */
      }

      const customerId = await resolveOrCreateCustomer(stripe, { email, userId });
      const description = `Full track unlock — ${song.title || "OG Bot track"}`;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: TRACK_UNLOCK_CURRENCY,
              unit_amount: TRACK_UNLOCK_PENCE,
              product_data: {
                name: nasheed ? "Nasheed full track unlock" : "Full track unlock",
              },
            },
            quantity: trackCardQuantity(nasheed),
          },
        ],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        payment_intent_data: {
          description,
          metadata: { userId, kind: "track_unlock", songId: data.songId },
        },
        metadata: {
          userId,
          kind: "track_unlock",
          songId: data.songId,
          environment: data.environment,
        },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      console.error("createTrackUnlockCheckoutSession failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

export const reconcileTrackUnlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { sessionId: string; environment: StripeEnv }) => {
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(data.sessionId)) throw new Error("Invalid sessionId");
    if (data.environment !== "sandbox" && data.environment !== "live")
      throw new Error("Invalid environment");
    return data;
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { status: "unlocked"; songId: string }
      | { status: "pending"; reason: string }
      | { error: string }
    > => {
      const { userId } = context;
      try {
        const stripe = createStripeClient(data.environment);
        const session = await stripe.checkout.sessions.retrieve(data.sessionId);
        const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
        if (meta.userId !== userId) return { error: "Session does not belong to this user" };
        if (meta.kind !== "track_unlock" || !meta.songId)
          return { error: "Not a track unlock session" };
        if (
          session.status !== "complete" ||
          (session.payment_status &&
            session.payment_status !== "paid" &&
            session.payment_status !== "no_payment_required")
        ) {
          return {
            status: "pending",
            reason: session.payment_status ?? session.status ?? "unknown",
          };
        }

        const { grantTrackUnlock } = await import("@/lib/track-unlock.server");
        const result = await grantTrackUnlock(
          userId,
          meta.songId,
          `stripe:${data.environment}:${session.id}`,
          session.amount_total,
        );
        if (!result.ok) return { error: result.error };
        // No referral reward on card payments (owner rule; see AGENTS.md).
        return { status: "unlocked", songId: meta.songId };
      } catch (error) {
        console.error("reconcileTrackUnlock failed", error);
        return { error: getStripeErrorMessage(error) };
      }
    },
  );

// -------------------------------------------------------------------------
// Purchase history: any user can see their own coin/VIP transactions.
// -------------------------------------------------------------------------

export type StripePurchaseDetails = {
  amountPaid: number;
  currency: string;
  refundedAmount: number;
  refunded: boolean;
  partiallyRefunded: boolean;
  description?: string | null;
};

export type PurchaseRow = {
  id: string;
  amount: number;
  type: string;
  reference: string | null;
  created_at: string;
  stripe?: StripePurchaseDetails | null;
};

const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);
function toMajorUnit(amount: number, currency: string) {
  const c = (currency ?? "").toLowerCase();
  if (ZERO_DECIMAL.has(c)) return amount;
  if (THREE_DECIMAL.has(c)) return amount / 1000;
  return amount / 100;
}

function parseStripeRef(ref: string | null): { env: StripeEnv; sessionId: string } | null {
  if (!ref) return null;
  const m = /^stripe:(sandbox|live):(?:store:)?(cs_(?:test|live)_[A-Za-z0-9]+)$/.exec(ref);
  return m ? { env: m[1] as StripeEnv, sessionId: m[2] } : null;
}

async function fetchStripeDetails(
  sessionId: string,
  env: StripeEnv,
  expectedUserId: string,
): Promise<StripePurchaseDetails | null> {
  try {
    const stripe = createStripeClient(env);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "payment_intent.latest_charge"],
    });
    if ((session.metadata?.userId ?? "") !== expectedUserId) return null;
    const charge: any = (session.payment_intent as any)?.latest_charge;
    if (!charge) return null;
    const currency = (charge.currency ?? session.currency ?? "usd") as string;
    const amountPaid = toMajorUnit(charge.amount ?? 0, currency);
    const refundedRaw = charge.amount_refunded ?? 0;
    const refundedAmount = toMajorUnit(refundedRaw, currency);
    const refunded = !!charge.refunded || refundedRaw >= (charge.amount ?? 0);
    return {
      amountPaid,
      currency,
      refundedAmount,
      refunded,
      partiallyRefunded: refundedRaw > 0 && !refunded,
      description: charge.description ?? null,
    };
  } catch (e) {
    console.error("fetchStripeDetails failed", e);
    return null;
  }
}

export const getCoinPurchaseHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PurchaseRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("coin_transactions")
      .select("id, amount, type, reference, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PurchaseRow[];

    const stripeRows = rows
      .filter(
        (r) =>
          ["stripe_purchase", "store_purchase"].includes(r.type) && parseStripeRef(r.reference),
      )
      .slice(0, 30);

    const enriched = await Promise.all(
      stripeRows.map(async (r) => {
        const ref = parseStripeRef(r.reference)!;
        if (!ref) return [r.id, null] as const;
        const details = await fetchStripeDetails(ref.sessionId, ref.env, userId);
        return [r.id, details] as const;
      }),
    );
    const detailMap = new Map(enriched);
    return rows.map((r) =>
      detailMap.has(r.id) ? { ...r, stripe: detailMap.get(r.id) ?? null } : r,
    );
  });

// -------------------------------------------------------------------------
// Boss/admin: cross-user purchase visibility
// -------------------------------------------------------------------------

export type AdminPurchaseRow = {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  amount: number;
  reference: string | null;
  created_at: string;
};

export type AdminPurchaseTotals = Record<string, { totalCoins: number; purchaseCount: number }>;

export const getAllCoinPurchases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ items: AdminPurchaseRow[]; totals: AdminPurchaseTotals }> => {
      const { supabase, userId } = context;
      const [bossRes, adminRes] = await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "boss" }),
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      ]);
      if (!bossRes.data && !adminRes.data) throw new Error("Forbidden");

      const { data, error } = await supabase
        .from("coin_transactions")
        .select("id, user_id, amount, reference, created_at")
        .eq("type", "stripe_purchase")
        .gt("amount", 0)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);

      const totals: AdminPurchaseTotals = {};
      const userIds = new Set<string>();
      for (const r of data ?? []) {
        userIds.add(r.user_id);
        const t = totals[r.user_id] ?? { totalCoins: 0, purchaseCount: 0 };
        t.totalCoins += r.amount ?? 0;
        t.purchaseCount += 1;
        totals[r.user_id] = t;
      }

      let profileMap = new Map<string, { email: string | null; display_name: string | null }>();
      if (userIds.size) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, email, display_name")
          .in("id", Array.from(userIds));
        profileMap = new Map(
          (profs ?? []).map((p: any) => [
            p.id,
            { email: p.email ?? null, display_name: p.display_name ?? null },
          ]),
        );
      }

      const items: AdminPurchaseRow[] = (data ?? []).slice(0, 300).map((r) => {
        const p = profileMap.get(r.user_id);
        return {
          id: r.id,
          user_id: r.user_id,
          amount: r.amount,
          reference: r.reference,
          created_at: r.created_at,
          email: p?.email ?? null,
          display_name: p?.display_name ?? null,
        };
      });

      return { items, totals };
    },
  );

// -------------------------------------------------------------------------
// Receipt link
// -------------------------------------------------------------------------

type ReceiptResult = { url: string } | { error: string };

export const getStripeReceiptUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { sessionId: string; environment: StripeEnv }) => {
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(data.sessionId)) throw new Error("Invalid sessionId");
    if (data.environment !== "sandbox" && data.environment !== "live")
      throw new Error("Invalid environment");
    return data;
  })
  .handler(async ({ data, context }): Promise<ReceiptResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId, {
        expand: ["payment_intent", "payment_intent.latest_charge", "invoice"],
      });
      if ((session.metadata?.userId ?? "") !== context.userId) {
        return { error: "Not your session" };
      }
      const charge = (session.payment_intent as any)?.latest_charge;
      if (charge?.receipt_url) return { url: charge.receipt_url };
      const invoice = session.invoice as any;
      if (invoice?.hosted_invoice_url) return { url: invoice.hosted_invoice_url };
      return { error: "No receipt available yet" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// -------------------------------------------------------------------------
// VIP-only instant refund. Issues a full Stripe refund and reverses the
// credited coins on the caller's balance. Idempotent if charge is already
// refunded.
// -------------------------------------------------------------------------

type RefundResult =
  | { status: "refunded"; refundedAmount: number; currency: string; newBalance: number }
  | { status: "already_refunded"; refundedAmount: number; currency: string }
  | { error: string };

export const refundCoinPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { sessionId: string; environment: StripeEnv }) => {
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(data.sessionId)) throw new Error("Invalid sessionId");
    if (data.environment !== "sandbox" && data.environment !== "live")
      throw new Error("Invalid environment");
    return data;
  })
  .handler(async ({ data, context }): Promise<RefundResult> => {
    const { supabase, userId } = context;
    try {
      const { data: isVip, error: roleErr } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "vip",
      });
      if (roleErr) return { error: roleErr.message };
      if (!isVip) return { error: "VIP membership required for instant refunds" };

      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId, {
        expand: ["payment_intent", "payment_intent.latest_charge"],
      });
      if ((session.metadata?.userId ?? "") !== userId) {
        return { error: "Not your session" };
      }
      const pi: any = session.payment_intent;
      const charge: any = pi?.latest_charge;
      if (!pi?.id || !charge) return { error: "No charge to refund" };

      const currency = (charge.currency ?? "usd") as string;
      const reference = `stripe:${data.environment}:${session.id}`;

      if (charge.refunded || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0)) {
        return {
          status: "already_refunded",
          refundedAmount: toMajorUnit(charge.amount_refunded ?? charge.amount ?? 0, currency),
          currency,
        };
      }

      // Refund rules: only within 14 days and only if none of the coins have been used.
      const REFUND_WINDOW_DAYS = 14;
      const createdMs = (session.created ?? 0) * 1000;
      if (Date.now() - createdMs > REFUND_WINDOW_DAYS * 86_400_000) {
        return {
          error: `Refunds are only available within ${REFUND_WINDOW_DAYS} days of purchase.`,
        };
      }
      // Take the coins back first, in one locked step that also checks none of
      // them have been spent. Doing it after the Stripe refund left a gap in
      // which coins could be spent and the money still refunded.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: clawback, error: clawErr } = await (supabaseAdmin as any).rpc(
        "clawback_stripe_purchase",
        {
          _user_id: userId,
          _purchase_reference: reference,
          _refund_id: null,
          _mode: "instant",
        },
      );
      if (clawErr) return { error: "Couldn't process the refund right now. Please try again." };
      const claw = (clawback ?? {}) as { clawed_back?: boolean; reason?: string; balance?: number };
      if (claw.reason === "coins_spent") {
        return {
          error: "Coins from this purchase have already been used, so it can't be refunded.",
        };
      }
      // "already_applied" means the coins were already taken back (e.g. an
      // earlier attempt stopped before Stripe ran), so finishing the Stripe
      // refund is correct. Stripe itself rejects a second full refund.

      let refund;
      try {
        refund = await stripe.refunds.create({ payment_intent: pi.id });
      } catch (stripeErr) {
        // Stripe didn't refund, so give the coins back.
        if (claw.clawed_back) {
          await (supabaseAdmin as any).rpc("restore_instant_refund_clawback", {
            _user_id: userId,
            _purchase_reference: reference,
          });
        }
        throw stripeErr;
      }
      const refundedAmount = toMajorUnit(refund.amount ?? 0, currency);
      const newBalance = Number(claw.balance ?? 0);

      return { status: "refunded", refundedAmount, currency, newBalance };
    } catch (error) {
      console.error("refundCoinPurchase failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

// ─── Billing portal (Manage my subscription) ──────────────────────────────
type PortalResult = { url: string } | { error: string };

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { returnUrl: string; environment: StripeEnv }) => {
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (!/^https?:\/\//.test(data.returnUrl)) throw new Error("Invalid returnUrl");
    return data;
  })
  .handler(async ({ data, context }): Promise<PortalResult> => {
    const { userId, supabase } = context;
    try {
      // Prefer the customer id from the latest synced subscription row.
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const stripe = createStripeClient(data.environment);
      let customerId = (sub?.stripe_customer_id as string | undefined) ?? null;

      // Fallback: search Stripe by metadata.userId (covers users who subscribed
      // before the subscriptions table was wired up).
      if (!customerId) {
        try {
          const found = await stripe.customers.search({
            query: `metadata['userId']:'${userId}'`,
            limit: 1,
          });
          customerId = found?.data?.[0]?.id ?? null;
        } catch (err) {
          // Stripe search can fail if the index isn't ready or the key
          // lacks the search permission. Fall back to email lookup.
          console.warn("billingPortal customer search failed, falling back", err);
          const { data: prof } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", userId)
            .maybeSingle();
          const email = (prof?.email as string | undefined) ?? undefined;
          if (email) {
            const list = await stripe.customers.list({ email, limit: 1 });
            customerId = list?.data?.[0]?.id ?? null;
          }
        }
      }
      if (!customerId) return { error: "No active subscription found." };

      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: data.returnUrl,
      });
      return { url: portal.url };
    } catch (error) {
      console.error("createBillingPortalSession failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

// -------------------------------------------------------------------------
// Refund status: returns the caller's refunds from the local mirror, and
// optionally refreshes the latest status from Stripe in case a webhook is
// delayed or hasn't been delivered yet.
// -------------------------------------------------------------------------

export type RefundRow = {
  id: string;
  stripe_refund_id: string;
  stripe_session_id: string | null;
  amount: number; // major units (e.g. 5.00)
  currency: string;
  status: string;
  reason: string | null;
  failure_reason: string | null;
  environment: StripeEnv;
  created_at: string;
  updated_at: string;
};

export const getMyRefunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { refresh?: boolean } | undefined) => data ?? {})
  .handler(async ({ data, context }): Promise<RefundRow[]> => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("payment_refunds")
      .select(
        "id, stripe_refund_id, stripe_session_id, amount, currency, status, reason, failure_reason, environment, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const working = (rows ?? []) as Array<RefundRow & { amount: number }>;

    // Live refresh: re-fetch up to 10 most recent refunds whose status is
    // still pending or that the caller asked to refresh.
    if (data.refresh && working.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const targets = working.filter((r) => data.refresh || r.status === "pending").slice(0, 10);
      await Promise.all(
        targets.map(async (r) => {
          try {
            const stripe = createStripeClient(r.environment);
            const live = await stripe.refunds.retrieve(r.stripe_refund_id);
            const liveStatus = live.status ?? r.status;
            const liveFailure = live.failure_reason ?? null;
            if (liveStatus !== r.status || liveFailure !== r.failure_reason) {
              r.status = liveStatus;
              r.failure_reason = liveFailure;
              await supabaseAdmin
                .from("payment_refunds")
                .update({
                  status: liveStatus,
                  failure_reason: liveFailure,
                  updated_at: new Date().toISOString(),
                })
                .eq("stripe_refund_id", r.stripe_refund_id);
            }
          } catch (e) {
            console.error("refund refresh failed", r.stripe_refund_id, e);
          }
        }),
      );
    }

    return working.map((r) => ({
      ...r,
      amount: toMajorUnit(r.amount, r.currency),
    }));
  });
