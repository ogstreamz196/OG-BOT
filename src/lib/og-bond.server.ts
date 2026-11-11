/**
 * The database side of OG B0T's friendships (og_bonds, see og-bond.ts).
 * Everything here is best-effort: if the table isn't there yet or a call
 * fails, OG B0T just treats people as neutral and carries on.
 */
import {
  bondDelta,
  bondNote,
  fadedScore,
  readBondSignal,
  type BondKind,
  type RoomPerson,
} from "@/lib/og-bond";

type Admin = any;

/** Today's (faded) scores for these members; anyone missing is neutral (0). */
export async function loadBonds(admin: Admin, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const { data, error } = await admin
      .from("og_bonds")
      .select("user_id, score, updated_at")
      .in("user_id", ids);
    if (error) return out;
    for (const r of (data ?? []) as { user_id: string; score: number; updated_at: string }[]) {
      out.set(r.user_id, fadedScore(Number(r.score) || 0, r.updated_at));
    }
  } catch {
    /* neutral */
  }
  return out;
}

/** Moves a member's score. Returns the score before and after (both 0 on failure). */
export async function nudgeBond(
  admin: Admin,
  userId: string,
  kind: BondKind | "hit_friend",
  delta: number,
): Promise<{ before: number; after: number }> {
  try {
    const { data, error } = await admin.rpc("og_bond_nudge", {
      p_user_id: userId,
      p_delta: delta,
      p_kind: kind,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return { before: 0, after: 0 };
    return { before: Number(row.before_score) || 0, after: Number(row.after_score) || 0 };
  } catch {
    return { before: 0, after: 0 };
  }
}

/**
 * One message from a member to OG B0T: reads how it feels about them from
 * it, saves the change, and returns the prompt note for this reply. `battle`
 * softens insults (they're the game there).
 */
export async function bondTurn(
  admin: Admin,
  userId: string,
  text: string,
  opts: { battle?: boolean; name?: string | null } = {},
): Promise<{ note: string; score: number; kind: BondKind }> {
  const kind = readBondSignal(text);
  const { before, after } = await nudgeBond(admin, userId, kind, bondDelta(kind, opts.battle));
  return { note: bondNote(after, kind, before, opts.name), score: after, kind };
}

/** The people in a room with their scores, for roomNote. */
export async function roomPeople(
  admin: Admin,
  people: { userId: string; name: string }[],
): Promise<RoomPerson[]> {
  const scores = await loadBonds(
    admin,
    people.map((p) => p.userId),
  );
  const seen = new Set<string>();
  const out: RoomPerson[] = [];
  for (const p of people) {
    if (seen.has(p.userId) || !p.name) continue;
    seen.add(p.userId);
    out.push({ name: p.name, score: scores.get(p.userId) ?? 0 });
  }
  return out;
}
