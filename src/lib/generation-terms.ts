import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Client-side mirror of the backend's sample rules. New tracks from the
 * Create wizard are paid up front (pay step), so this now only guards older
 * flows (e.g. a draft's Generate button): at least 5 coins in the balance,
 * and after 3 unpaid tracks each new sample costs 2 coins. The backend re-checks and charges atomically
 * via start_generation_charge in suno-generate — this module only warns and
 * confirms up front so members aren't surprised.
 */

export type GenerationTerms = {
  balance: number;
  min_balance: number;
  free_limit: number;
  unpaid_count: number;
  sample_cost: number;
};

/** The member's own terms from the database. Null when the check can't run — the backend still enforces everything. */
export async function fetchGenerationTerms(): Promise<GenerationTerms | null> {
  try {
    const { data, error } = (await supabase.rpc("my_generation_terms" as never)) as unknown as {
      data: GenerationTerms | null;
      error: { message: string } | null;
    };
    if (error) {
      console.error("my_generation_terms failed", error.message);
      return null;
    }
    return data ?? null;
  } catch (e) {
    console.error("my_generation_terms failed", e);
    return null;
  }
}

const goTo = (path: string) => {
  window.location.assign(path);
};

/** Below the 5-coin minimum: refuse with ways to fix the balance. */
function refuseForBalance(terms: GenerationTerms): boolean {
  toast.error(
    `A track costs ${terms.min_balance} OG coins (or £0.99 by card on ogbot.co.uk). Top up or earn coins to carry on.`,
    {
      duration: 12000,
      action: { label: "Get coins", onClick: () => goTo("/buy-coins") },
      cancel: { label: "Earn free", onClick: () => goTo("/referrals") },
    },
  );
  return false;
}

/** Sample costs 2 coins now: ask before cooking. */
function confirmPaidSample(terms: GenerationTerms): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    toast.warning(
      `You've made ${terms.unpaid_count} tracks without unlocking one, so this sample costs ${terms.sample_cost} OG coins (balance: ${terms.balance}). Unlock any of your tracks to reset free samples.`,
      {
        duration: Infinity,
        closeButton: true,
        action: { label: `Cook it — ${terms.sample_cost} coins`, onClick: () => finish(true) },
        cancel: { label: "Not now", onClick: () => finish(false) },
        onDismiss: () => finish(false),
      },
    );
  });
}

/**
 * Gate for brand-new samples (library create flows and a draft's Generate
 * button). Resolves true to carry on cooking, false when the member chose
 * not to or is below the balance minimum.
 */
export async function confirmGenerationAllowed(): Promise<boolean> {
  const terms = await fetchGenerationTerms();
  // Check unavailable — let the backend decide rather than blocking creation.
  if (!terms) return true;

  if (terms.balance < terms.min_balance) return refuseForBalance(terms);

  if (terms.sample_cost > 0) return confirmPaidSample(terms);

  // Last free sample: warn so the next one isn't a surprise.
  if (terms.unpaid_count === terms.free_limit - 1) {
    toast.info(
      "Heads up — that's your last free sample. Unlock one of your tracks, or the next one costs 2 OG coins.",
      { duration: 8000 },
    );
  }
  return true;
}

/** Shape suno-generate returns on success for a brand-new sample. */
export type SampleChargeInfo = {
  sample_charged?: number;
  unpaid_count?: number | null;
  sample_fee_warning?: boolean;
};

/** After the backend accepted the job, tell the member what it cost. */
export function announceSampleCharge(data: SampleChargeInfo | null | undefined): void {
  const charged = data?.sample_charged ?? 0;
  if (charged > 0) {
    toast.info(
      `${charged} OG coins used for this sample — unlock one of your tracks to reset your free samples.`,
    );
  } else if (data?.sample_fee_warning) {
    toast.info(
      "That was your last free sample — the next one costs 2 OG coins unless you unlock a track.",
    );
  }
}
