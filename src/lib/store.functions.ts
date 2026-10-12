import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

// ─── shared types ─────────────────────────────────────────────────────────
export type StoreCategory = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  sort_order: number;
  active: boolean;
};

export type StoreItem = {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  coin_price: number | null;
  currency: string;
  recurring_interval: "month" | "year" | null;
  stock: number | null;
  stock_sold: number;
  coin_reward: number | null;
  perk_slug: string | null;
  rarity: "common" | "rare" | "epic" | "legendary";
  sort_order: number;
  active: boolean;
};

export type SportsGuideAccessStatus = {
  owned: boolean;
  status: "unowned" | "owned" | "invite_sent" | "joined" | "revoked";
  telegramLinked: boolean;
  groupConfigured: boolean;
  inviteExpiresAt: string | null;
  inviteUrl: string | null;
};

export type StoreCatalog = {
  categories: (StoreCategory & { items: StoreItem[] })[];
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,60}$/;
const CURRENCY_RE = /^[a-z]{3}$/;

// ─── public: list catalog (any signed-in user) ───────────────────────────
export const listStoreCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoreCatalog> => {
    const { supabase } = context;
    const [cats, items] = await Promise.all([
      supabase
        .from("store_categories")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("store_items")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
    ]);
    if (cats.error) throw new Error(cats.error.message);
    if (items.error) throw new Error(items.error.message);
    const byCat = new Map<string, StoreItem[]>();
    for (const it of (items.data ?? []) as StoreItem[]) {
      const arr = byCat.get(it.category_id) ?? [];
      arr.push(it);
      byCat.set(it.category_id, arr);
    }
    return {
      categories: ((cats.data ?? []) as StoreCategory[]).map((c) => ({
        ...c,
        items: byCat.get(c.id) ?? [],
      })),
    };
  });

export const getSportsGuideAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SportsGuideAccessStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [access, profile, setting] = await Promise.all([
      supabaseAdmin
        .from("sports_guide_access")
        .select("status, invite_expires_at, telegram_invite_link")
        .eq("user_id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("telegram_chat_id")
        .eq("id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "telegram.sports_guide_group_id")
        .maybeSingle(),
    ]);
    if (access.error) throw new Error(access.error.message);
    if (profile.error) throw new Error(profile.error.message);
    if (setting.error) throw new Error(setting.error.message);
    let status = access.data?.status as SportsGuideAccessStatus["status"] | undefined;
    // VIP members (incl. the free trial) get the in-app Sports Guide included.
    if (!status || status === "revoked") {
      const { data: viaVip } = await supabaseAdmin.rpc("has_sports_guide_access", {
        _user: context.userId,
      });
      if (viaVip) status = "owned";
    }
    return {
      owned: !!status && status !== "revoked",
      status: status ?? "unowned",
      telegramLinked: !!profile.data?.telegram_chat_id,
      groupConfigured: setting.data?.value !== null && setting.data?.value !== undefined,
      inviteExpiresAt: access.data?.invite_expires_at ?? null,
      inviteUrl: access.data?.telegram_invite_link ?? null,
    };
  });

export const purchaseSportsGuideAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("purchase_sports_guide_access_for_user", {
      p_user: context.userId,
    });
    if (error) throw new Error(error.message);
    return data as { ok: boolean; already_owned: boolean; status: string; coin_balance?: number };
  });

export const claimSportsGuideInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const telegramKey = process.env.TELEGRAM_API_KEY;
    if (!lovableKey || !telegramKey) throw new Error("Telegram is not configured");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [access, profile, setting] = await Promise.all([
      supabaseAdmin
        .from("sports_guide_access")
        .select("status")
        .eq("user_id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("telegram_chat_id")
        .eq("id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "telegram.sports_guide_group_id")
        .maybeSingle(),
    ]);
    if (!access.data || access.data.status === "revoked")
      throw new Error("Buy Sports Guide access first");
    if (!profile.data?.telegram_chat_id) throw new Error("Connect Telegram in Settings first");
    const groupId = setting.data?.value;
    if (typeof groupId !== "number" && typeof groupId !== "string") {
      throw new Error("The private Sports Guide group is not ready yet");
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const headers = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": telegramKey,
      "Content-Type": "application/json",
    };
    const inviteResponse = await fetch(
      "https://connector-gateway.lovable.dev/telegram/createChatInviteLink",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          chat_id: groupId,
          name: `OG Sports Guide · ${context.userId.slice(0, 8)}`,
          expire_date: expiresAt,
          member_limit: 1,
        }),
      },
    );
    const inviteBody = (await inviteResponse.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { invite_link?: string };
    } | null;
    const inviteLink = inviteBody?.result?.invite_link;
    if (!inviteResponse.ok || inviteBody?.ok !== true || !inviteLink) {
      throw new Error(inviteBody?.description ?? "Could not create the Telegram invite");
    }
    const messageResponse = await fetch(
      "https://connector-gateway.lovable.dev/telegram/sendMessage",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          chat_id: profile.data.telegram_chat_id,
          text: `🏆 <b>OG SPORTS GUIDE ACCESS</b>\n\nYour private one-use invite is ready. It expires in 24 hours.\n\n${inviteLink}\n\nDo not share this link — only one person can use it.`,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    const messageBody = (await messageResponse.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    if (!messageResponse.ok || messageBody?.ok !== true) {
      throw new Error(messageBody?.description ?? "Invite created, but Telegram delivery failed");
    }
    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("sports_guide_access")
      .update({
        status: "invite_sent",
        telegram_invite_link: inviteLink,
        invite_expires_at: new Date(expiresAt * 1000).toISOString(),
        invite_sent_at: now,
      })
      .eq("user_id", context.userId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true as const, expiresAt: new Date(expiresAt * 1000).toISOString() };
  });

// ─── admin: list everything (incl. inactive) ─────────────────────────────
export const listAllStoreItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const [cats, items] = await Promise.all([
      supabase.from("store_categories").select("*").order("sort_order", { ascending: true }),
      supabase.from("store_items").select("*").order("sort_order", { ascending: true }),
    ]);
    if (cats.error) throw new Error(cats.error.message);
    if (items.error) throw new Error(items.error.message);
    return {
      categories: (cats.data ?? []) as StoreCategory[],
      items: (items.data ?? []) as StoreItem[],
    };
  });

// ─── admin: upsert item ──────────────────────────────────────────────────
type UpsertInput = {
  id?: string;
  category_id: string;
  slug: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price_cents: number;
  coin_price?: number | null;
  currency: string;
  recurring_interval?: "month" | "year" | null;
  stock?: number | null;
  coin_reward?: number | null;
  perk_slug?: string | null;
  rarity: "common" | "rare" | "epic" | "legendary";
  sort_order?: number;
  active?: boolean;
};

export const upsertStoreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UpsertInput) => {
    if (!data.category_id) throw new Error("category_id required");
    if (!SLUG_RE.test(data.slug)) throw new Error("Slug must be lowercase letters/digits/-/_");
    if (!data.name?.trim()) throw new Error("Name required");
    if (!Number.isInteger(data.price_cents) || data.price_cents < 0)
      throw new Error("Invalid price");
    if (data.coin_price != null && (!Number.isInteger(data.coin_price) || data.coin_price < 1))
      throw new Error("OG Coin price must be a positive whole number");
    if (!CURRENCY_RE.test(data.currency)) throw new Error("Invalid currency");
    if (
      data.recurring_interval &&
      data.recurring_interval !== "month" &&
      data.recurring_interval !== "year"
    ) {
      throw new Error("Invalid interval");
    }
    if (!["common", "rare", "epic", "legendary"].includes(data.rarity))
      throw new Error("Invalid rarity");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const row = {
      category_id: data.category_id,
      slug: data.slug,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      image_url: data.image_url?.trim().replace(/^http:\/\//i, "https://") || null,
      price_cents: data.price_cents,
      coin_price: data.coin_price ?? null,
      currency: data.currency.toLowerCase(),
      recurring_interval: data.recurring_interval ?? null,
      stock: data.stock ?? null,
      coin_reward: data.coin_reward ?? null,
      perk_slug: data.perk_slug?.trim() || null,
      rarity: data.rarity,
      sort_order: data.sort_order ?? 0,
      active: data.active ?? true,
    };

    if (data.id) {
      const { error } = await supabase.from("store_items").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await supabase
      .from("store_items")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted!.id as string };
  });

export const deleteStoreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    // Soft-delete via active=false to preserve purchase history references.
    const { error } = await supabase
      .from("store_items")
      .update({ active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── admin: category upsert / delete ─────────────────────────────────────
export const upsertStoreCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      slug: string;
      label: string;
      description?: string;
      sort_order?: number;
      active?: boolean;
    }) => {
      if (!SLUG_RE.test(d.slug)) throw new Error("Invalid slug");
      if (!d.label?.trim()) throw new Error("Label required");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const row = {
      slug: data.slug,
      label: data.label.trim(),
      description: data.description?.trim() || null,
      sort_order: data.sort_order ?? 0,
      active: data.active ?? true,
    };
    if (data.id) {
      const { error } = await supabase.from("store_categories").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabase
      .from("store_categories")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: ins!.id as string };
  });

// ─── admin: reorder helpers ──────────────────────────────────────────────
export const reorderStoreItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[] }) => {
    if (!Array.isArray(d.ids) || d.ids.length === 0) throw new Error("ids required");
    if (d.ids.length > 200) throw new Error("too many ids");
    for (const id of d.ids) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid id");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    // Sequential updates keep it simple and safe under RLS.
    for (let i = 0; i < data.ids.length; i++) {
      const { error } = await supabase
        .from("store_items")
        .update({ sort_order: i })
        .eq("id", data.ids[i]);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const reorderStoreCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[] }) => {
    if (!Array.isArray(d.ids) || d.ids.length === 0) throw new Error("ids required");
    if (d.ids.length > 100) throw new Error("too many ids");
    for (const id of d.ids) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid id");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    for (let i = 0; i < data.ids.length; i++) {
      const { error } = await supabase
        .from("store_categories")
        .update({ sort_order: i })
        .eq("id", data.ids[i]);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ─── purchase: create Stripe embedded checkout session ───────────────────
type CheckoutResult = { clientSecret: string } | { error: string };

export const createStoreItemCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.itemId)) throw new Error("Invalid itemId");
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (!/^https?:\/\//.test(data.returnUrl)) throw new Error("Invalid returnUrl");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    const { userId, supabase } = context;
    try {
      const { data: item, error } = await supabase
        .from("store_items")
        .select("*")
        .eq("id", data.itemId)
        .eq("active", true)
        .maybeSingle();
      if (error || !item) return { error: "Item unavailable" };
      const it = item as StoreItem;
      if (it.stock !== null && it.stock_sold >= it.stock) {
        return { error: "Sold out" };
      }

      const stripe = createStripeClient(data.environment);

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

      // Resolve/create Customer inline (mirrors payments.functions helper).
      let customerId: string | undefined;
      try {
        if (userId) {
          const found = await stripe.customers.search({
            query: `metadata['userId']:'${userId}'`,
            limit: 1,
          });
          if (found?.data?.length) customerId = found.data[0].id;
        }
        if (!customerId && email) {
          const existing = await stripe.customers.list({ email, limit: 1 });
          if (existing?.data?.length) {
            customerId = existing.data[0].id;
            if (existing.data[0].metadata?.userId !== userId) {
              await stripe.customers.update(customerId, {
                metadata: { ...existing.data[0].metadata, userId },
              });
            }
          }
        }
        if (!customerId) {
          const created = await stripe.customers.create({
            ...(email && { email }),
            metadata: { userId },
          });
          customerId = created.id;
        }
      } catch (e) {
        console.warn("customer resolve fallback", e);
      }

      const isRecurring = !!it.recurring_interval;
      const bundleId = `store:${it.id}`;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: it.currency,
              unit_amount: it.price_cents,
              product_data: {
                name: it.name,
                ...(it.description && { description: it.description }),
                ...(it.image_url &&
                  /^https?:\/\//.test(it.image_url) && { images: [it.image_url] }),
              },
              ...(isRecurring && { recurring: { interval: it.recurring_interval! } }),
            },
            quantity: 1,
          },
        ],
        mode: isRecurring ? "subscription" : "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        ...(customerId && { customer: customerId }),
        metadata: {
          userId,
          bundleId,
          storeItemId: it.id,
          coins: String(it.coin_reward ?? 0),
          perkSlug: it.perk_slug ?? "",
          environment: data.environment,
        },
        ...(!isRecurring && {
          payment_intent_data: {
            description: it.name,
            metadata: {
              userId,
              bundleId,
              storeItemId: it.id,
              coins: String(it.coin_reward ?? 0),
              perkSlug: it.perk_slug ?? "",
            },
          },
        }),
        ...(isRecurring && {
          subscription_data: {
            metadata: {
              userId,
              bundleId,
              storeItemId: it.id,
              perkSlug: it.perk_slug ?? "",
            },
          },
        }),
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      console.error("createStoreItemCheckoutSession failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });
