import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseOgChatInput, type ChatReply } from "@/lib/og-chat-input";
// The chat itself lives in og-chat.server.ts, loaded lazily so the persona,
// swear lexicon and learner code are never bundled into the client.

export type { OgChatMessage } from "@/lib/og-chat-input";

/**
 * Unified chat backend for the OG Bot page and the floating widget (the
 * non-streaming path; /api/og/chat streams the same thing).
 */
export const chatOgBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(parseOgChatInput)
  .handler(async ({ data, context }): Promise<ChatReply> => {
    const { runOgChat } = await import("@/lib/og-chat.server");
    return runOgChat(data, context);
  });
