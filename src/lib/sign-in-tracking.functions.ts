import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_TG = "https://connector-gateway.lovable.dev/telegram";

async function sendTelegramDirect(
  chatId: number,
  text: string,
  targetUserId?: string,
): Promise<{ ok: boolean; error?: string; stale?: boolean; attempts?: number }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const tgKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !tgKey) return { ok: false, error: "missing_keys" };

  // Exponential backoff: retry transient failures (network errors, 5xx, 429, 408)
  // up to MAX_ATTEMPTS times. Permanent errors (chat not found, blocked, other
  // 4xx) exit early so we don't hammer the gateway.
  const MAX_ATTEMPTS = 4;
  const BASE_MS = 400;
  let lastErr = "send_failed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status = 0;
    let desc = "";
    try {
      const res = await fetch(`${GATEWAY_TG}/sendMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": tgKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      });
      if (res.ok) return { ok: true, attempts: attempt };
      status = res.status;
      const j = (await res.json().catch(() => null)) as {
        description?: string;
        parameters?: { retry_after?: number };
      } | null;
      desc = j?.description ?? `http_${res.status}`;
      lastErr = desc;

      const stale =
        /chat not found|bot was blocked|user is deactivated|chat was deleted|bot was kicked/i.test(
          desc,
        );
      if (stale) {
        if (targetUserId) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin
              .from("profiles")
              .update({
                telegram_chat_id: null,
                telegram_linked_at: null,
                telegram_link_token: null,
              })
              .eq("id", targetUserId);
          } catch {
            /* ignore */
          }
        }
        return { ok: false, error: desc, stale: true, attempts: attempt };
      }

      // 4xx (except 408/429) = permanent client error, don't retry.
      const retryable = status >= 500 || status === 429 || status === 408;
      if (!retryable) {
        return { ok: false, error: desc, attempts: attempt };
      }

      // Honor Telegram's retry_after hint for 429; otherwise exponential + jitter.
      const retryAfter = j?.parameters?.retry_after;
      const backoff = retryAfter
        ? Math.min(retryAfter * 1000, 8000)
        : Math.min(BASE_MS * 2 ** (attempt - 1), 6000) + Math.floor(Math.random() * 250);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, backoff));
      }
    } catch (e) {
      // Network/timeout: retry.
      lastErr = (e as Error).message;
      if (attempt < MAX_ATTEMPTS) {
        const backoff =
          Math.min(BASE_MS * 2 ** (attempt - 1), 6000) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  return { ok: false, error: lastErr, attempts: MAX_ATTEMPTS };
}

// ---------- main: recordSignIn ----------

export const recordSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("sign_in_count")
      .eq("id", context.userId)
      .maybeSingle();
    const isSignup = !prof?.sign_in_count || prof.sign_in_count === 0;
    await supabaseAdmin.from("sign_in_events").insert({
      user_id: context.userId,
      is_signup: isSignup,
    });
    await supabaseAdmin
      .from("profiles")
      .update({
        last_sign_in_at: new Date().toISOString(),
        sign_in_count: (prof?.sign_in_count ?? 0) + 1,
      })
      .eq("id", context.userId);
    void notifyBosses({
      userId: context.userId,
      isSignup,
    }).catch(() => {});
    if (!isSignup) {
      const { alertBossPresence } = await import("@/lib/presence-alert.server");
      await alertBossPresence(context.userId, "app");
    }
    return { ok: true as const, isSignup };
  });

async function notifyBosses(ev: { userId: string; isSignup: boolean }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // All admins/bosses with a Telegram chat id
  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "boss"]);
  const adminIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
  if (adminIds.length === 0) return;

  const { data: prefsRows } = await supabaseAdmin
    .from("boss_notification_prefs")
    .select("*")
    .in("user_id", adminIds);
  const prefsMap = new Map((prefsRows ?? []).map((p) => [p.user_id, p]));

  const { data: bossProfiles } = await supabaseAdmin
    .from("profiles")
    .select("id, telegram_chat_id")
    .in("id", adminIds);
  const chatMap = new Map(
    (bossProfiles ?? []).map((b) => [b.id, b.telegram_chat_id as number | null]),
  );

  const when = new Date().toLocaleString("en-GB", { timeZone: "UTC" });
  const text =
    `<b>${ev.isSignup ? "🆕 New account" : "🔐 Sign-in"}</b>\n` +
    `Account <code>${escapeHtml(ev.userId.slice(0, 8))}</code>\n` +
    `<i>${when} UTC</i>`;

  for (const bossId of adminIds) {
    const prefs = prefsMap.get(bossId);
    const notify = prefs
      ? (ev.isSignup && prefs.notify_on_signup) || (prefs.notify_every_signin && !ev.isSignup)
      : ev.isSignup;

    if (!notify) continue;
    const chatId = chatMap.get(bossId);
    if (!chatId) continue;

    // Queue + try send (with internal exponential backoff retries)
    const { data: q } = await supabaseAdmin
      .from("telegram_dm_queue")
      .insert({
        target_user_id: bossId,
        body: text,
        status: "pending",
        attempts: 1,
      })
      .select("id")
      .single();
    const sendResult = await sendTelegramDirect(chatId, text, bossId);
    if (q?.id) {
      await supabaseAdmin
        .from("telegram_dm_queue")
        .update({
          status: sendResult.ok ? "sent" : "failed",
          attempts: sendResult.attempts ?? 1,
          sent_at: sendResult.ok ? new Date().toISOString() : null,
          last_error: sendResult.ok
            ? null
            : ((sendResult.stale ? `stale_chat:${sendResult.error}` : sendResult.error) ??
              "send_failed"),
        })
        .eq("id", q.id);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ---------- Boss notification preferences ----------

export const getBossNotifPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;
    const { data: roleOk } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: bossOk } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "boss",
    });
    if (!roleOk && !bossOk) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let { data } = await supabaseAdmin
      .from("boss_notification_prefs")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) {
      const ins = await supabaseAdmin
        .from("boss_notification_prefs")
        .insert({ user_id: context.userId })
        .select("*")
        .single();
      data = ins.data;
    }
    return data;
  });

export const updateBossNotifPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      d: Partial<{
        notify_on_signup: boolean;
        notify_every_signin: boolean;
        notify_new_device: boolean;
        notify_new_country: boolean;
        notify_suspicious: boolean;
        sheets_sync_enabled: boolean;
        quiet_hours_start: number | null;
        quiet_hours_end: number | null;
      }>,
    ) => d ?? {},
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: roleOk } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: bossOk } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "boss",
    });
    if (!roleOk && !bossOk) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("boss_notification_prefs")
      .upsert({ user_id: context.userId, ...data, updated_at: new Date().toISOString() })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- Admin reads ----------

export const getUserSignInHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; limit?: number }) => ({
    userId: d.userId,
    limit: Math.min(Math.max(d.limit ?? 20, 1), 100),
  }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: ok } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: bossOk } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "boss",
    });
    if (!ok && !bossOk) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: events }, { data: devices }] = await Promise.all([
      supabaseAdmin
        .from("sign_in_events")
        .select("*")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(data.limit),
      supabaseAdmin
        .from("user_devices")
        .select("*")
        .eq("user_id", data.userId)
        .order("last_seen_at", { ascending: false }),
    ]);
    return { events: events ?? [], devices: devices ?? [] };
  });

export const listUsersPro = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string }) => ({ search: (d?.search ?? "").trim().slice(0, 100) }))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: ok } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: bossOk } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "boss",
    });
    if (!ok && !bossOk) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("profiles")
      .select(
        "id, email, display_name, coin_balance, created_at, telegram_chat_id, telegram_linked_at, last_sign_in_at, sign_in_count",
      )
      .order("last_sign_in_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (data.search) {
      q = q.or(`email.ilike.%${data.search}%,display_name.ilike.%${data.search}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const sendTestBossNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;
    const { data: ok } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const { data: bossOk } = await supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "boss",
    });
    if (!ok && !bossOk) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("telegram_chat_id, display_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof?.telegram_chat_id) {
      return { ok: false as const, reason: "Boss has no Telegram linked" };
    }
    const sent = await sendTelegramDirect(
      prof.telegram_chat_id as number,
      `🧪 <b>Test notification</b>\nBoss console is wired correctly, ${escapeHtml(prof.display_name ?? "boss")}.`,
      context.userId,
    );
    return { ok: sent.ok, error: sent.error, stale: sent.stale };
  });
