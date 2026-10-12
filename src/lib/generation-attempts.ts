import { supabase } from "@/integrations/supabase/client";

/**
 * Database-first job staging: every creation attempt gets a row the moment
 * the user taps create, so a failure before the song row exists still leaves
 * a traceable record with the stage and exact error. Logging never throws.
 */
type Patch = {
  song_id?: string | null;
  title?: string | null;
  stage?: string;
  status?: "started" | "failed" | "succeeded";
  error_message?: string | null;
  context?: Record<string, unknown>;
};

const table = () => supabase.from("generation_attempts" as never);

export async function startAttempt(userId: string, patch: Patch): Promise<string | null> {
  try {
    const { data } = await table()
      .insert({ user_id: userId, status: "started", ...patch } as never)
      .select("id")
      .single();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

export async function updateAttempt(id: string | null, patch: Patch) {
  if (!id) return;
  try {
    await table()
      .update(patch as never)
      .eq("id", id);
  } catch {
    /* logging must never break generation */
  }
}

export function describeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack?.slice(0, 1500) };
  return { value: String(e) };
}
