// Picks the instant "hold on" line for a trade signal from the shared bank
// (bot_catchphrases, kind 'trade_hold'). Each user only ever gets lines they
// haven't seen; when someone runs low, new lines are added to the bank for
// everyone (AI-written in the background, or built from fragments on the spot
// if they've seen them all).
import {
  freshHoldingLines,
  holdingMessage,
  renderHoldingLine,
  type HoldingTone,
  type Instrument,
} from "./trade-signal";

type Admin = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
type Picked = { phrase: string | null; left: number };

const LOW_WATER = 3;

async function pick(admin: Admin, userId: string, tone: HoldingTone): Promise<Picked> {
  const { data, error } = await admin.rpc("pick_trade_hold", { p_user: userId, p_tone: tone });
  if (error || !data) throw new Error("pick_trade_hold failed");
  const d = data as { phrase?: string | null; left?: number };
  return { phrase: d.phrase ?? null, left: d.left ?? 0 };
}

export async function pickTradeHold(
  admin: Admin,
  userId: string,
  inst: Instrument,
  tone: HoldingTone,
): Promise<string> {
  try {
    let got = await pick(admin, userId, tone);
    if (!got.phrase) {
      // Seen them all: add brand-new lines for everyone, then pick one of those.
      await admin.rpc("add_catchphrases", {
        p_kind: "trade_hold",
        p_tone: tone,
        p_phrases: freshHoldingLines(tone, 8),
      });
      got = await pick(admin, userId, tone);
    }
    if (got.left <= LOW_WATER) {
      const { refillCatchphrases } = await import("@/lib/og-catchphrases.server");
      refillCatchphrases(admin, "trade_hold", tone);
    }
    if (got.phrase) return renderHoldingLine(got.phrase, inst);
  } catch (e) {
    console.warn("[trade-hold] bank unavailable, using a built-in line", e);
  }
  return holdingMessage(inst, tone);
}
