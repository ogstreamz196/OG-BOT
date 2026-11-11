import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Boss → OG Bot → Telegram: the groups OG B0T (the Gaffer) runs and the worker
 * bots switched on in each (see telegram-worker.server.ts). Boss/admin only,
 * checked on the server.
 */

const TRADE_BOT_WEBHOOK = "https://ogbot.co.uk/api/public/trade-bot/webhook";
const IN_CHAT = ["member", "administrator", "creator"];

type Ctx = { userId: string; supabase: unknown };

async function requireBoss(context: Ctx) {
  const supabase = context.supabase as {
    rpc: (
      fn: "has_role",
      args: { _user_id: string; _role: "admin" },
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  };
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const chatIdOf = (d: unknown): number => {
  const raw = String((d as { chatId?: unknown })?.chatId ?? "").trim();
  if (!/^-?\d{5,20}$/.test(raw)) throw new Error("That's not a Telegram chat ID");
  return Number(raw);
};

export type GroupRow = {
  chatId: string;
  title: string | null;
  type: string;
  gafferPresent: boolean;
  gafferAddedAt: string | null;
  workers: string[];
  updatedAt: string;
};

export const listTelegramGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBoss(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { workerConfigured } = await import("@/lib/telegram-worker.server");
    const { data, error } = await supabaseAdmin
      .from("telegram_managed_groups" as never)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);
    const rows = (
      (data ?? []) as {
        chat_id: number;
        chat_title: string | null;
        chat_type: string;
        og_bot_present: boolean;
        og_bot_added_at: string | null;
        active_workers: string[] | null;
        updated_at: string;
      }[]
    ).map(
      (r): GroupRow => ({
        chatId: String(r.chat_id),
        title: r.chat_title,
        type: r.chat_type,
        gafferPresent: r.og_bot_present,
        gafferAddedAt: r.og_bot_added_at,
        workers: r.active_workers ?? [],
        updatedAt: r.updated_at,
      }),
    );
    return {
      groups: rows,
      // The table isn't there until its migration runs.
      ready: !error,
      tradeBotConfigured: workerConfigured(),
    };
  });

export const setGroupWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ({
    chatId: chatIdOf(d),
    worker: /^(trade|[a-f0-9-]{36})$/.test(String((d as { worker?: unknown })?.worker))
      ? String((d as { worker?: unknown }).worker)
      : null,
    on: !!(d as { on?: unknown })?.on,
  }))
  .handler(async ({ context, data }) => {
    await requireBoss(context as Ctx);
    if (!data.worker) throw new Error("Unknown worker");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { managedGroup } = await import("@/lib/telegram-worker.server");
    const group = await managedGroup(supabaseAdmin, data.chatId);
    if (!group) throw new Error("Group not found. Sync it first.");
    if (data.worker !== "trade") {
      const { data: bot } = await supabaseAdmin
        .from("telegram_worker_bots")
        .select("id")
        .eq("id", data.worker)
        .maybeSingle();
      if (!bot) throw new Error("Unknown worker");
    }
    const { data: workers, error } = await supabaseAdmin.rpc("set_telegram_worker", {
      p_chat: data.chatId,
      p_worker: data.worker,
      p_on: data.on,
    });
    if (error) throw new Error(error.message);
    return { workers };
  });

/** Asks Telegram whether each bot is in the chat, and updates the register. */
export const syncTelegramGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ({ chatId: chatIdOf(d) }))
  .handler(async ({ context, data }) => {
    await requireBoss(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { telegramApi } = await import("@/lib/telegram-api.server");
    const w = await import("@/lib/telegram-worker.server");
    const chatId = data.chatId;

    const chat = await telegramApi<{ id: number; title?: string; type?: string }>("getChat", {
      chat_id: chatId,
    });
    const me = await telegramApi<{ id: number }>("getMe", {});
    const gafferStatus =
      chat?.ok && me?.result?.id
        ? (
            await telegramApi<{ status?: string }>("getChatMember", {
              chat_id: chatId,
              user_id: me.result.id,
            })
          )?.result?.status
        : undefined;
    const gafferPresent = IN_CHAT.includes(gafferStatus ?? "");
    if (chat?.ok || (await w.managedGroup(supabaseAdmin, chatId))) {
      await w.recordGaffer(
        supabaseAdmin,
        { id: chatId, title: chat?.result?.title, type: chat?.result?.type },
        gafferPresent,
      );
    }

    let tradeBot: "in" | "not_in" | "not_set_up" = "not_set_up";
    if (w.workerConfigured()) {
      const wme = await w.workerApi<{ id: number }>("getMe", {});
      const status = wme?.result?.id
        ? (
            await w.workerApi<{ status?: string }>("getChatMember", {
              chat_id: chatId,
              user_id: wme.result.id,
            })
          )?.result?.status
        : undefined;
      tradeBot = IN_CHAT.includes(status ?? "") ? "in" : "not_in";
    }
    return {
      found: !!chat?.ok,
      title: chat?.result?.title ?? null,
      gafferPresent,
      tradeBot,
      // Telegram's reason when OG B0T can't see the chat at all.
      problem: chat?.ok ? null : (chat?.description ?? "Telegram didn't answer"),
    };
  });

/** A test line from OG B0T and, where it's allowed to work, the trade bot. */
export const pingTelegramGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ({ chatId: chatIdOf(d) }))
  .handler(async ({ context, data }) => {
    await requireBoss(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { telegramApi } = await import("@/lib/telegram-api.server");
    const w = await import("@/lib/telegram-worker.server");
    const gaffer = await telegramApi("sendMessage", {
      chat_id: data.chatId,
      text: "🏓 Ping from OG B0T. The Gaffer's in the building.",
    });
    let tradeBot: "sent" | "failed" | "not_allowed" | "not_set_up" = "not_set_up";
    if (w.workerConfigured()) {
      if (!(await w.workerAllowed(supabaseAdmin, data.chatId, "trade"))) tradeBot = "not_allowed";
      else {
        const res = await w.workerApi("sendMessage", {
          chat_id: data.chatId,
          text: "🏓 Chart slave reporting for duty. Crayons sharpened, Gaffer.",
        });
        tradeBot = res?.ok ? "sent" : "failed";
      }
    }
    return {
      gaffer: gaffer?.ok ? "sent" : "failed",
      gafferProblem: gaffer?.ok ? null : (gaffer?.description ?? null),
      tradeBot,
    };
  });

/** Points the trade bot's Telegram updates at our webhook (with its secret). */
export const connectTradeBotWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBoss(context as Ctx);
    const token = process.env.SIGNALS_BOT_TOKEN;
    if (!token) throw new Error("SIGNALS_BOT_TOKEN isn't set");
    const w = await import("@/lib/telegram-worker.server");
    const res = await w.workerApi("setWebhook", {
      url: TRADE_BOT_WEBHOOK,
      secret_token: w.tradeBotSecret(token),
      allowed_updates: ["message", "my_chat_member"],
    });
    if (!res?.ok) throw new Error(res?.description ?? "Telegram didn't accept it");
    const me = await w.workerApi<{ username?: string }>("getMe", {});
    return { ok: true, botUsername: me?.result?.username ?? null };
  });
