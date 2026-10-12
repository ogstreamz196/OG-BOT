import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";

/**
 * Integration test for the referrals SQL surface:
 *   - claim_referral is one-shot per referee
 *   - claim_referral rejects self-referrals
 *   - deduct_coins credits 6%/13% cashback to the referrer
 *
 * Runs against the live Supabase DB via psql using the standard PG* env
 * vars. Skipped automatically when those vars are not present (e.g. on a
 * developer machine without DB credentials).
 */

function canSeed(): boolean {
  if (!process.env.PGHOST) return false;
  try {
    const out = execFileSync(
      "psql",
      ["-tA", "-c", "SELECT has_schema_privilege(current_user, 'auth', 'USAGE')"],
      { encoding: "utf8" },
    ).trim();
    return out === "t";
  } catch {
    return false;
  }
}
const HAS_DB = canSeed();

function psql(sql: string): string {
  return execFileSync("psql", ["-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

function asUser(uid: string, sql: string): string {
  // Impersonate a signed-in user by setting the JWT claim auth.uid() reads.
  const wrapped = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', true); ${sql}`;
  return execFileSync(
    "psql",
    ["-tA", "-v", "ON_ERROR_STOP=1", "-c", `BEGIN; ${wrapped}; COMMIT;`],
    { encoding: "utf8" },
  ).trim();
}

describe.skipIf(!HAS_DB)("referrals SQL contract", () => {
  const referrer = randomUUID();
  const referee = randomUUID();

  beforeAll(() => {
    // Seed two real auth users + profiles so RLS / FKs are honoured.
    for (const [id, email] of [
      [referrer, `ref-${referrer}@test.local`],
      [referee, `ree-${referee}@test.local`],
    ]) {
      psql(
        `INSERT INTO auth.users (id, email, instance_id, aud, role)
         VALUES ('${id}', '${email}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
         ON CONFLICT (id) DO NOTHING`,
      );
      psql(
        `INSERT INTO public.profiles (id, email, display_name, coin_balance)
         VALUES ('${id}', '${email}', 'Test ${id.slice(0, 6)}', 100)
         ON CONFLICT (id) DO UPDATE SET coin_balance = 100`,
      );
    }
  });

  it("rejects self-referral", () => {
    const out = asUser(referee, `SELECT public.claim_referral('${referee}')`);
    expect(out).toBe("f");
  });

  it("claims a referral exactly once", () => {
    const first = asUser(referee, `SELECT public.claim_referral('${referrer}')`);
    expect(first).toBe("t");
    const second = asUser(referee, `SELECT public.claim_referral('${referrer}')`);
    expect(second).toBe("f");

    const row = psql(
      `SELECT referrer_id::text FROM public.referrals WHERE referee_id = '${referee}'`,
    );
    expect(row).toBe(referrer);
  });

  it("credits 6% cashback to a free referrer on burn", () => {
    const before = Number(
      psql(`SELECT coin_balance FROM public.profiles WHERE id = '${referrer}'`),
    );
    asUser(referee, `SELECT public.deduct_coins('${referee}', 50, 'test_burn')`);
    const after = Number(psql(`SELECT coin_balance FROM public.profiles WHERE id = '${referrer}'`));
    expect(after - before).toBe(3); // floor(50 * 0.06)

    const tx = psql(
      `SELECT amount FROM public.coin_transactions
       WHERE user_id = '${referrer}' AND type = 'referral_cashback'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(Number(tx)).toBe(3);
  });
});
