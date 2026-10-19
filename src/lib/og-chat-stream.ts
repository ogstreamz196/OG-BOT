// Client side of /api/og-chat: streams OG Bot's reply word by word.
import { supabase } from "@/integrations/supabase/client";
import type { ChatReply, OgChatMessage } from "@/lib/og-chat-input";

/** The stream couldn't start (old deploy, network); the caller should use the normal call. */
export class StreamUnavailable extends Error {}

export async function streamOgChat(
  input: {
    messages: OgChatMessage[];
    mode?: "safe" | "og";
    attachmentDataUrl?: string;
    language?: string;
    pageContext?: string;
  },
  onDelta: (delta: string) => void,
): Promise<ChatReply> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new StreamUnavailable("no session");
  let res: Response;
  try {
    res = await fetch("/api/og-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new StreamUnavailable("network");
  }
  if (res.status === 400) throw new Error((await res.text().catch(() => "")) || "Bad request");
  if (!res.ok || !res.body) throw new StreamUnavailable(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final: ChatReply | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: { t?: string; d?: string; message?: string } & Partial<ChatReply>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.t === "delta" && msg.d) onDelta(msg.d);
      else if (msg.t === "error") throw new Error(msg.message || "OG Bot couldn't respond");
      else if (msg.t === "done") {
        const { t: _t, d: _d, message: _m, ...reply } = msg;
        final = reply as ChatReply;
      }
    }
    if (done) break;
  }
  if (!final) throw new Error("OG Bot couldn't respond right now");
  return final;
}
