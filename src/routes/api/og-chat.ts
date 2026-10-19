import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Streams an OG Bot private-chat reply as it's written. Same sign-in check
// and the same chat code as the chatOgBot server function; the stream is
// newline-delimited JSON:
//   {"t":"delta","d":"..."}  words as they arrive
//   {"t":"done", ...reply}   the final, post-processed reply (replaces the draft)
//   {"t":"error","message"}  something went wrong
export const Route = createFileRoute("/api/og-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!url || !key || !token) return new Response("Unauthorized", { status: 401 });
        const supabase = createClient(url, key, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: claims, error } = await supabase.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (error || !userId) return new Response("Unauthorized", { status: 401 });

        const { parseOgChatInput } = await import("@/lib/og-chat-input");
        let input: ReturnType<typeof parseOgChatInput>;
        try {
          input = parseOgChatInput(await request.json());
        } catch (e) {
          return new Response((e as Error).message || "Bad request", { status: 400 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (obj: unknown) =>
              controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
            try {
              const { runOgChat } = await import("@/lib/og-chat.server");
              const reply = await runOgChat(input, { userId }, (d) => send({ t: "delta", d }));
              send({ t: "done", ...reply });
            } catch (e) {
              send({ t: "error", message: (e as Error).message || "OG Bot couldn't respond" });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
