import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFleetBoss as boss } from "./telegram-fleet-access";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const connectionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[^@\n]+$/),
  token: z
    .string()
    .trim()
    .regex(/^\d+:[A-Za-z0-9_-]{20,}$/),
  chatId: z
    .string()
    .trim()
    .regex(/^-\d{5,16}$/)
    .refine((v) => Number.isSafeInteger(Number(v))),
  role: z.enum(["trade", "assistant"]),
  instructions: z.string().trim().max(2000),
});
export const fleetActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["connect", "ping", "enable", "disable"]),
  chatId: z
    .string()
    .regex(/^-\d{5,16}$/)
    .optional(),
});
export const listFleet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await boss(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { FLEET_COLUMNS } = await import("./telegram-fleet.server");
    const { data, error } = await admin
      .from("telegram_worker_bots")
      .select(FLEET_COLUMNS)
      .order("created_at");
    if (error) throw new Error("Worker list unavailable");
    return data ?? [];
  });
export const saveFleetBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(connectionSchema)
  .handler(async ({ context, data }) => {
    await boss(context);
    const key = process.env["TELEGRAM_CREDENTIAL_KEY"];
    if (!key) throw new Error("Secure bot storage is not ready yet");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const f = await import("./telegram-fleet.server");
    const { telegramApi } = await import("./telegram-api.server");
    const { recordGaffer } = await import("./telegram-worker.server");
    const me = await f.botApi<{ id: number; username: string; is_bot: boolean }>(
      data.token,
      "getMe",
      {},
    );
    if (!me.ok || !me.result?.is_bot) throw new Error("Telegram rejected that bot token");
    const gaffer = await telegramApi<{ id: number }>("getMe", {});
    if (gaffer?.result?.id === me.result.id)
      throw new Error("Use a worker bot token, not the Gaffer token");
    const chatId = Number(data.chatId);
    const chat = await telegramApi<{ id: number; title?: string; type?: string }>("getChat", {
      chat_id: chatId,
    });
    const membership = gaffer?.result?.id
      ? await telegramApi<{ status: string }>("getChatMember", {
          chat_id: chatId,
          user_id: gaffer.result.id,
        })
      : null;
    if (
      !chat?.ok ||
      !["member", "administrator", "creator"].includes(membership?.result?.status ?? "")
    )
      throw new Error("Add telegram og bot to this chat first, then try again");
    const workerMember = await f.botApi<{ status: string }>(data.token, "getChatMember", {
      chat_id: chatId,
      user_id: me.result.id,
    });
    if (
      !workerMember.ok ||
      !["member", "administrator", "creator"].includes(workerMember.result?.status ?? "")
    )
      throw new Error("Add the worker bot to this chat before connecting");
    if (data.id) {
      const { data: old } = await admin
        .from("telegram_worker_bots")
        .select("bot_id")
        .eq("id", data.id)
        .single();
      if (old?.bot_id !== me.result.id)
        throw new Error("Replacement token must belong to the same bot");
    }
    const { data: saved, error } = await admin
      .from("telegram_worker_bots")
      .upsert(
        {
          ...(data.id ? { id: data.id } : {}),
          bot_id: me.result.id,
          username: me.result.username,
          name: data.name,
          role: data.role,
          instructions: data.instructions,
          token_ciphertext: await f.sealToken(data.token, key),
          enabled: true,
          created_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "bot_id" },
      )
      .select("id")
      .single();
    if (error || !saved) throw new Error("Bot connection could not be saved");
    await recordGaffer(
      admin,
      { id: chatId, title: chat.result?.title, type: chat.result?.type },
      true,
    );
    const { error: attachError } = await admin.rpc("set_telegram_worker", {
      p_chat: chatId,
      p_worker: saved.id,
      p_on: true,
    });
    if (attachError) throw new Error("Bot saved, but chat assignment failed");
    const webhook = await f.botApi(data.token, "setWebhook", {
      url: `https://ogbot.co.uk/api/public/worker-bots/${saved.id}`,
      secret_token: f.fleetSecret(saved.id, key),
      allowed_updates: ["message", "my_chat_member"],
    });
    await admin
      .from("telegram_worker_bots")
      .update({ webhook_connected: webhook.ok })
      .eq("id", saved.id);
    return {
      id: saved.id,
      connected: webhook.ok,
      problem: webhook.ok
        ? null
        : "Saved securely; webhook registration failed. Use Register webhook to retry.",
    };
  });
export const fleetAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(fleetActionSchema)
  .handler(async ({ context, data }) => {
    await boss(context);
    const key = process.env["TELEGRAM_CREDENTIAL_KEY"];
    if (!key) throw new Error("Secure bot storage unavailable");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const f = await import("./telegram-fleet.server");
    if (data.action === "enable" || data.action === "disable") {
      const { error } = await admin
        .from("telegram_worker_bots")
        .update({ enabled: data.action === "enable", updated_at: new Date().toISOString() })
        .eq("id", data.id);
      if (error) throw new Error("Could not change worker status");
      return { ok: true };
    }
    if (data.action === "ping") {
      if (!data.chatId || !(await f.fleetAllowed(data.id, Number(data.chatId))))
        throw new Error("Worker is not enabled in this Gaffer chat");
      const res = await f.fleetApi(
        data.id,
        "sendMessage",
        { chat_id: Number(data.chatId), text: "Worker reporting for duty. The Gaffer sent me." },
        key,
      );
      if (!res.ok) throw new Error(res.description ?? "Ping failed");
    } else {
      const res = await f.fleetApi(
        data.id,
        "setWebhook",
        {
          url: `https://ogbot.co.uk/api/public/worker-bots/${data.id}`,
          secret_token: f.fleetSecret(data.id, key),
          allowed_updates: ["message", "my_chat_member"],
        },
        key,
      );
      if (!res.ok) throw new Error(res.description ?? "Webhook connection failed");
      await admin
        .from("telegram_worker_bots")
        .update({ webhook_connected: true })
        .eq("id", data.id);
    }
    return { ok: true };
  });
