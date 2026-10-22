import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Transcribe a short audio clip via the Lovable AI Gateway
 * (OpenAI-compatible /v1/audio/transcriptions). Used by the mic
 * button in OG Bot to drop dictation straight into the composer.
 */
export const transcribeOgAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { audioBase64: string; mime?: string }) => {
    if (!data?.audioBase64 || typeof data.audioBase64 !== "string") {
      throw new Error("audioBase64 required");
    }
    // Cap roughly 8MB of base64 (~6MB binary) to stay well under gateway limits.
    if (data.audioBase64.length > 8_000_000) {
      throw new Error("Recording too long — keep clips under ~2 minutes.");
    }
    const mime = (data.mime || "audio/webm").toLowerCase();
    return { audioBase64: data.audioBase64, mime };
  })
  .handler(async ({ data }): Promise<{ text: string }> => {
    const baseMime = data.mime.split(";")[0].trim();
    const bytes = Buffer.from(data.audioBase64, "base64");
    if (bytes.length < 512) {
      throw new Error("Recording was empty — try again.");
    }

    const { transcribeWithGemini } = await import("@/lib/ai-endpoint.server");
    const text = await transcribeWithGemini(data.audioBase64, baseMime);
    return { text };
  });
