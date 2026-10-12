// Server-only: builds a compact, factual snapshot of ONE user's account so
// OG Bot can answer "when does my VIP end?", "what tracks have I made?" etc.
// Only the requesting user's own records are read. No IP, location or device
// data is ever included (privacy minimisation requirement).

type AnyClient = { from: (t: string) => any };

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      })
    : "unknown";

const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

const TX_LABEL: Record<string, string> = {
  purchase: "bought coins",
  generation: "made a track",
  refund: "refund",
  battle_reward: "Battle Zone reward",
  welcome_bonus: "welcome bonus",
  daily_drop: "Daily Drop",
  referral: "referral reward",
  unlock: "unlocked a track",
};

export async function loadUserDossier(admin: AnyClient, userId: string): Promise<string> {
  const [prof, roles, subs, songs, inflight, txs, totals] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "display_name, email, coin_balance, created_at, referral_code, telegram_username, telegram_linked_at, og_vip_id",
      )
      .eq("id", userId)
      .maybeSingle(),
    admin.from("user_roles").select("role, expires_at").eq("user_id", userId),
    admin
      .from("subscriptions")
      .select("status, price_id, current_period_end, cancel_at_period_end, environment")
      .eq("user_id", userId)
      .eq("environment", "live")
      .order("created_at", { ascending: false })
      .limit(1),
    admin
      .from("songs")
      .select("id, title, style, created_at, is_public, revealed, unlocked, is_variation, lyrics")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("songs")
      .select("title, status, created_at")
      .eq("user_id", userId)
      .in("status", ["pending", "processing", "queued", "generating", "failed"])
      .order("created_at", { ascending: false })
      .limit(3),
    admin
      .from("coin_transactions")
      .select("amount, type, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("songs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed"),
  ]);

  const p = prof.data ?? {};
  const roleList: string[] = (roles.data ?? []).map((r: { role: string }) => r.role);
  const lines: string[] = [
    "LIVE ACCOUNT FACTS for this user (authoritative — use these to answer account, VIP, coin and track questions; never invent beyond them):",
  ];

  lines.push(`- Name: ${p.display_name ?? "unknown"} · Member since ${fmtDate(p.created_at)}`);
  lines.push(
    `- Recovery email on file: ${p.email && !String(p.email).endsWith("@ogstreamz.app") ? "yes" : "no — suggest adding one in Profile"}`,
  );
  lines.push(`- OG Coins balance: ${p.coin_balance ?? 0}`);
  if (p.og_vip_id) lines.push(`- OG VIP ID (their yearly VIP verification code): ${p.og_vip_id}`);
  lines.push(
    "- VIP cancellation rule: cancelling any time only stops auto-renew; VIP stays active until the paid month/year ends.",
  );

  // VIP
  const sub = subs.data?.[0];
  const hasVipRole = roleList.includes("vip");
  if (sub && ["active", "trialing", "past_due"].includes(sub.status)) {
    const plan = /year/i.test(sub.price_id ?? "") ? "OG VIP Yearly" : "OG VIP Monthly";
    lines.push(
      `- VIP: ${plan}, status ${sub.status}. ${sub.cancel_at_period_end ? `Auto-renew is OFF — VIP ends on ${fmtDate(sub.current_period_end)}.` : `Renews on ${fmtDate(sub.current_period_end)}.`} Billed via web card payment.`,
    );
  } else if (hasVipRole) {
    const vipRow = (roles.data ?? []).find((r: { role: string }) => r.role === "vip") as
      | { expires_at?: string | null }
      | undefined;
    lines.push(
      vipRow?.expires_at
        ? `- VIP: active, granted by the Boss. VIP ends on ${fmtDate(vipRow.expires_at)} (no auto-renew).`
        : "- VIP: active with no end date (lifetime, Boss-granted or app store subscription).",
    );
  } else {
    lines.push(
      `- VIP: not a VIP${sub ? ` (last web subscription ${sub.status}, ended ${fmtDate(sub.current_period_end)})` : ""}. VIP is £4.99/month or £50/year in the Store.`,
    );
  }
  if (roleList.includes("admin") || roleList.includes("boss")) lines.push("- Role: Boss/admin.");

  // Tracks
  lines.push(`- Finished tracks: ${totals.count ?? 0}`);
  const list = (songs.data ?? []) as any[];
  list.forEach((s, i) => {
    const state = [
      s.is_variation ? "2nd take" : null,
      s.unlocked ? "fully unlocked" : "sample only (locked)",
      s.is_public && s.revealed ? "public" : "private",
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(
      `  ${i + 1}. "${s.title || "Untitled"}" — ${s.style ? String(s.style).slice(0, 60) : "no style"} — made ${fmtDate(s.created_at)} — ${state} — link https://ogbot.co.uk/library/${s.id}`,
    );
  });
  const latestLyrics = list.find((s) => s.lyrics)?.lyrics as string | undefined;
  if (latestLyrics)
    lines.push(`- Lyrics of latest track (excerpt):\n${latestLyrics.slice(0, 700)}`);

  const busy = (inflight.data ?? []) as any[];
  busy.forEach((s) =>
    lines.push(
      `- In progress: "${s.title || "Untitled"}" is ${s.status === "failed" ? "retrying automatically" : "being made right now"} (started ${ago(s.created_at)}). Finished tracks appear in the Library; Telegram-linked users get a ping.`,
    ),
  );

  // Coins
  (txs.data ?? []).forEach((t: any) =>
    lines.push(
      `- Coin activity: ${Number(t.amount) > 0 ? "+" : ""}${t.amount} (${TX_LABEL[t.type] ?? t.type}) ${ago(t.created_at)}`,
    ),
  );

  if (p.referral_code) lines.push(`- Invite link: https://ogbot.co.uk/r/${p.referral_code}`);
  lines.push(
    `- Telegram: ${p.telegram_linked_at ? `linked${p.telegram_username ? ` as @${p.telegram_username}` : ""}` : "not linked — they can connect from the Profile page"}`,
  );

  // Extras: store passes, referral circle, Battle Zone record. Soft-fail each.
  const [sports, vault, refs, refEarn, battle] = await Promise.all([
    admin.from("sports_guide_access").select("status, joined_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1),
    admin.from("vip_pass_purchases").select("id").eq("user_id", userId).limit(1),
    admin.from("referrals").select("referee_id", { count: "exact", head: true }).eq("referrer_id", userId),
    admin.from("coin_transactions").select("amount").eq("user_id", userId).eq("type", "referral").limit(1000),
    admin.from("battle_tallies").select("rounds, streak_days, total_awarded_coins, last_battle_date").eq("user_id", userId).maybeSingle(),
  ]).catch(() => [{}, {}, {}, {}, {}] as any[]);

  const sg = sports?.data?.[0];
  lines.push(
    `- OG Sports Guide access: ${sg ? `${sg.status}${sg.joined_at ? ", joined the group" : ""}` : "not owned (available in the Store)"}`,
  );
  const isVipNow = hasVipRole || (sub && ["active", "trialing", "past_due"].includes(sub.status));
  lines.push(
    `- OG Vault Access Pass: ${vault?.data?.length ? "owned — code & PIN shown on the Vault card in the Store" : "not owned (free during the 15-day signup trial, otherwise £10 or 50 OG Coins in the Store; not included with VIP)"}`,
  );
  const earned = (refEarn?.data ?? []).reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
  lines.push(
    `- Referral circle: ${refs?.count ?? 0} friends invited, ${earned} coins earned lifetime (rate: ${isVipNow ? "13% VIP" : "6% free"} of friends' coin spends)`,
  );
  const b = battle?.data;
  lines.push(
    b
      ? `- Battle Zone: ${b.rounds} rounds, current streak ${b.streak_days} day(s), ${Number(b.total_awarded_coins)} coins won${b.last_battle_date ? `, last battled ${fmtDate(b.last_battle_date)}` : ""}`
      : "- Battle Zone: hasn't battled yet",
  );

  return lines.join("\n");
}
