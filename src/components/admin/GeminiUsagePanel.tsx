import { useQuery } from "@tanstack/react-query";
import { Activity, Coins, MessageSquare, Music4, Mic2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  feature: string;
  provider: string;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
};

// Rough pay-as-you-go rates for Gemini Flash-class models (USD per 1M tokens).
// Used only for the on-screen estimate — Google's invoice is the real figure.
const INPUT_RATE = 0.3;
const OUTPUT_RATE = 2.5;

const FEATURE_LABELS: Record<string, { label: string; Icon: typeof Sparkles }> = {
  chat: { label: "OG Bot chat", Icon: MessageSquare },
  lyrics: { label: "Song lyrics", Icon: Music4 },
  interview_question: { label: "Song interview", Icon: Sparkles },
  interview_summary: { label: "Interview brief", Icon: Sparkles },
  transcription: { label: "Voice notes", Icon: Mic2 },
};

function since(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function GeminiUsagePanel() {
  const q = useQuery({
    queryKey: ["ai-usage-log"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("ai_usage_log")
        .select(
          "feature, provider, model, prompt_tokens, completion_tokens, total_tokens, created_at",
        )
        .gte("created_at", since(30))
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const rows = q.data ?? [];
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = rows.filter((r) => new Date(r.created_at) >= todayStart);
  const week = rows.filter((r) => new Date(r.created_at) >= new Date(since(7)));

  const sum = (list: Row[]) => ({
    calls: list.length,
    prompt: list.reduce((a, r) => a + r.prompt_tokens, 0),
    completion: list.reduce((a, r) => a + r.completion_tokens, 0),
  });
  const est = (s: { prompt: number; completion: number }) =>
    (s.prompt / 1_000_000) * INPUT_RATE + (s.completion / 1_000_000) * OUTPUT_RATE;

  const t = sum(today);
  const w = sum(week);
  const m = sum(rows);

  const geminiRows = rows.filter((r) => r.provider.startsWith("gemini"));
  const byFeature = Object.entries(
    geminiRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.feature] = (acc[r.feature] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const money = (usd: number) => (usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`);

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card/70 p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-black">
        <Activity className="h-5 w-5 text-primary" />
        Gemini usage
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Live count of every AI call the app makes. Google doesn't share your key's remaining balance
        with apps, so this is our own meter — the cost is an estimate, your Google invoice is the
        exact figure.
      </p>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading usage…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { label: "Today", s: t },
                { label: "7 days", s: w },
                { label: "30 days", s: m },
              ] as const
            ).map(({ label, s }) => (
              <div
                key={label}
                className="rounded-xl border border-border bg-background/60 p-3 text-center"
              >
                <p className="text-xs font-bold uppercase text-muted-foreground">{label}</p>
                <p className="mt-1 font-display text-2xl font-black">{s.calls}</p>
                <p className="text-xs text-muted-foreground">calls</p>
                <p className="mt-1 flex items-center justify-center gap-1 text-xs font-bold text-primary">
                  <Coins className="h-3 w-3" />
                  {s.prompt + s.completion > 0 ? `~${money(est(s))}` : "—"}
                </p>
              </div>
            ))}
          </div>

          {byFeature.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-xs font-bold uppercase text-muted-foreground">
                Last 30 days by feature
              </p>
              {byFeature.map(([feature, count]) => {
                const meta = FEATURE_LABELS[feature] ?? { label: feature, Icon: Sparkles };
                return (
                  <div key={feature} className="flex items-center gap-2 text-sm">
                    <meta.Icon className="h-3.5 w-3.5 text-primary" />
                    <span>{meta.label}</span>
                    <span className="ml-auto font-bold">{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {rows.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No AI calls recorded yet — the meter starts counting from now.
            </p>
          )}
        </>
      )}
    </section>
  );
}
