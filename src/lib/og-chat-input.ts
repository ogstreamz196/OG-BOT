// Shared input checks for OG Bot chat (the server function and the
// streaming route both use them).
export type OgChatMessage = { role: "user" | "assistant"; content: string };

export type OgChatInput = {
  messages: OgChatMessage[];
  pageContext: string;
  mode: "safe" | "og";
  attachmentDataUrl?: string;
  language: string;
};

export interface ChatReply {
  reply: string;
  coin_balance: number;
  learned_insults?: string[];
  /** True when OG Bot is pitching a diss track; the client shows the ambush card. */
  ambush?: boolean;
  /** Set when the reply is a trade signal: when it stops being valid (ISO). */
  signal_expires_at?: string | null;
}

export const parseOgChatInput = (data: {
  messages: OgChatMessage[];
  pageContext?: string;
  mode?: "safe" | "og";
  attachmentDataUrl?: string;
  language?: string;
}) => {
  if (!data || !Array.isArray(data.messages)) throw new Error("messages required");
  const messages = data.messages.slice(-30).map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: String(m.content ?? "").slice(0, 4000),
  }));
  if (messages.length === 0) throw new Error("Empty conversation");
  const pageContext = typeof data.pageContext === "string" ? data.pageContext.slice(0, 200) : "";
  const mode: "safe" | "og" = data.mode === "safe" ? "safe" : "og";
  const language =
    typeof data.language === "string" && data.language.trim()
      ? data.language.trim().slice(0, 40)
      : "English";
  let attachmentDataUrl: string | undefined;
  if (
    typeof data.attachmentDataUrl === "string" &&
    data.attachmentDataUrl.startsWith("data:image/")
  ) {
    if (data.attachmentDataUrl.length > 8_000_000) throw new Error("Image too large (max ~6MB).");
    attachmentDataUrl = data.attachmentDataUrl;
  }
  return { messages, pageContext, mode, attachmentDataUrl, language };
};
