import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SportsGuidePost = {
  id: string;
  telegram_message_id: number;
  raw_text: string;
  sport_category: string;
  event_time: string | null;
  posted_at: string;
};

export type SportsGuideHub = {
  owned: boolean;
  coinPrice: number | null;
  balance: number;
  telegramLinked: boolean;
  posts: SportsGuidePost[];
  reminders: string[]; // post ids
};

export const getSportsGuideHub = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SportsGuideHub> => {
    const { supabase, userId } = context;
    const [{ data: owned }, item, profile] = await Promise.all([
      supabase.rpc("has_sports_guide_access", { _user: userId }),
      supabase.from("store_items").select("coin_price").eq("slug", "og-sports-guide-access").maybeSingle(),
      supabase.from("profiles").select("coin_balance, telegram_chat_id").eq("id", userId).maybeSingle(),
    ]);
    let posts: SportsGuidePost[] = [];
    let reminders: string[] = [];
    if (owned) {
      const [p, r] = await Promise.all([
        supabase
          .from("sports_guide_posts")
          .select("id, telegram_message_id, raw_text, sport_category, event_time, posted_at")
          .order("posted_at", { ascending: false })
          .limit(500),
        supabase.from("sports_guide_reminders").select("post_id").eq("user_id", userId).is("sent_at", null),
      ]);
      posts = (p.data ?? []) as SportsGuidePost[];
      reminders = (r.data ?? []).map((x) => x.post_id);
    }
    return {
      owned: !!owned,
      coinPrice: item.data?.coin_price ?? null,
      balance: Number(profile.data?.coin_balance ?? 0),
      telegramLinked: !!profile.data?.telegram_chat_id,
      posts,
      reminders,
    };
  });

export const syncSportsGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: owned } = await supabase.rpc("has_sports_guide_access", { _user: userId });
    if (!owned) throw new Error("Unlock Sports Guide first");
    const { sweepDeletedSportsGuidePosts } = await import("./sports-guide.server");
    const removed = await sweepDeletedSportsGuidePosts();
    return { removed };
  });

export const toggleSportsGuideReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid(), leadMinutes: z.number().int().min(5).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: owned } = await supabase.rpc("has_sports_guide_access", { _user: userId });
    if (!owned) throw new Error("Unlock Sports Guide first");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const existing = await supabaseAdmin
      .from("sports_guide_reminders")
      .select("id")
      .eq("user_id", userId)
      .eq("post_id", data.postId)
      .maybeSingle();
    if (existing.data) {
      await supabaseAdmin.from("sports_guide_reminders").delete().eq("id", existing.data.id);
      return { on: false };
    }
    const [{ data: post }, { data: prof }] = await Promise.all([
      supabaseAdmin.from("sports_guide_posts").select("event_time, posted_at").eq("id", data.postId).maybeSingle(),
      supabaseAdmin.from("profiles").select("telegram_chat_id").eq("id", userId).maybeSingle(),
    ]);
    if (!prof?.telegram_chat_id) throw new Error("Link Telegram in Settings to get reminders");
    if (!post?.event_time) throw new Error("This post has no kick-off time");
    const { eventInstant } = await import("./sports-guide.server");
    const at = eventInstant(post.posted_at, post.event_time);
    const remindAt = new Date(at.getTime() - data.leadMinutes * 60_000);
    if (at.getTime() < Date.now()) throw new Error("This event has already started");
    const { error } = await supabaseAdmin.from("sports_guide_reminders").insert({
      user_id: userId,
      post_id: data.postId,
      remind_at: remindAt < new Date() ? new Date().toISOString() : remindAt.toISOString(),
    });
    if (error) throw new Error(error.message);
    return { on: true, remindAt: remindAt.toISOString() };
  });
