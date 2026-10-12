// Fire-and-forget AI usage logging for the Boss dashboard cost panel.
// Never throws, never blocks the caller's response.
import { adminClient } from "./clients.ts";

export type AiUsageEntry = {
  feature: string;
  provider: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

/** Extract token counts from a Gemini generateContent response body. */
export function geminiUsage(data: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const u = (
    data as {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    } | null
  )?.usageMetadata;
  return {
    promptTokens: u?.promptTokenCount ?? 0,
    completionTokens: u?.candidatesTokenCount ?? 0,
    totalTokens: u?.totalTokenCount ?? 0,
  };
}

export function logAiUsage(entry: AiUsageEntry): void {
  const run = async () => {
    try {
      await adminClient()
        .from("ai_usage_log")
        .insert({
          feature: entry.feature,
          provider: entry.provider,
          model: entry.model ?? null,
          prompt_tokens: entry.promptTokens ?? 0,
          completion_tokens: entry.completionTokens ?? 0,
          total_tokens: entry.totalTokens ?? 0,
        });
    } catch (e) {
      console.warn("ai_usage_log insert failed", e);
    }
  };
  // @ts-expect-error EdgeRuntime is available in the edge function runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-expect-error see above
    EdgeRuntime.waitUntil(run());
  } else {
    void run();
  }
}
