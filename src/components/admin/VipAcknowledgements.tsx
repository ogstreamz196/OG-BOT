import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, Crown, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

type Row = {
  user_id: string;
  og_vip_id: string | null;
  acknowledged_at: string | null;
  created_at: string;
  profile?: {
    display_name: string | null;
    email: string | null;
    telegram_username: string | null;
    telegram_chat_id: number | null;
  };
};

export function VipAcknowledgements() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["vip-acks"],
    queryFn: async (): Promise<Row[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
      const { data, error } = await (supabase as any)
        .from("vip_acknowledgements")
        .select("user_id, og_vip_id, acknowledged_at, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      const ids = rows.map((r) => r.user_id);
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, email, telegram_username, telegram_chat_id")
          .in("id", ids);
        const map = new Map((profs ?? []).map((p) => [p.id, p]));
        rows.forEach((r) => (r.profile = map.get(r.user_id) as Row["profile"]));
      }
      return rows;
    },
  });

  const ack = useMutation({
    mutationFn: async (userId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
      const { error } = await (supabase as any)
        .from("vip_acknowledgements")
        .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: user!.id })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Added to verified OG VIPs");
      qc.invalidateQueries({ queryKey: ["vip-acks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];
  const pending = rows.filter((r) => !r.acknowledged_at);
  const verified = rows.filter((r) => r.acknowledged_at);

  const chatLink = (r: Row) =>
    r.profile?.telegram_username
      ? `https://t.me/${r.profile.telegram_username}`
      : r.profile?.telegram_chat_id
        ? `tg://user?id=${r.profile.telegram_chat_id}`
        : null;

  const Item = ({ r }: { r: Row }) => {
    const link = chatLink(r);
    return (
      <li className="flex min-w-0 flex-wrap items-center gap-3 border-t border-border px-3 py-3 first:border-t-0">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {r.profile?.display_name || r.profile?.email || r.user_id.slice(0, 8)}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono text-coin">{r.og_vip_id ?? "—"}</span>
            {" · "}
            {r.profile?.telegram_username ? `@${r.profile.telegram_username}` : "No Telegram"}
          </p>
        </div>
        {link && (
          <Button asChild size="sm" variant="outline">
            <a href={link} target="_blank" rel="noreferrer">
              <MessageCircle className="mr-1 h-4 w-4" /> Chat
            </a>
          </Button>
        )}
        {!r.acknowledged_at ? (
          <Button size="sm" onClick={() => ack.mutate(r.user_id)} disabled={ack.isPending}>
            <Check className="mr-1 h-4 w-4" /> Confirm
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <BadgeCheck className="h-4 w-4" /> Verified
          </span>
        )}
      </li>
    );
  };

  return (
    <section className="mb-5 rounded-xl border border-border bg-card p-3 sm:p-4">
      <h2 className="flex items-center gap-2 text-lg">
        <Crown className="h-5 w-5 text-coin" /> Yearly VIPs to acknowledge
        {pending.length > 0 && (
          <span className="rounded-full bg-destructive px-2 text-xs text-destructive-foreground">
            {pending.length}
          </span>
        )}
      </h2>
      {q.isLoading ? (
        <Loader2 className="mt-3 h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">All caught up — nothing waiting.</p>
          ) : (
            <ul className="mt-3 rounded-lg border border-border">
              {pending.map((r) => (
                <Item key={r.user_id} r={r} />
              ))}
            </ul>
          )}
          {verified.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Verified OG VIP list ({verified.length})
              </summary>
              <ul className="mt-2 rounded-lg border border-border">
                {verified.map((r) => (
                  <Item key={r.user_id} r={r} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
