import { Capacitor } from "@capacitor/core";
import { useQuery } from "@tanstack/react-query";
import { Crown } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";

/**
 * Small "who made this" tag. Website only, boss only — the Android/iOS builds
 * never render it, and it shows a public display name, never private details.
 */
export function CreatorTag({ userId, className }: { userId?: string | null; className?: string }) {
  const { isBoss } = useRole();
  const native = Capacitor.isNativePlatform();
  const enabled = !!userId && isBoss && !native;

  const { data } = useQuery({
    queryKey: ["creator-tag", userId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId!)
        .maybeSingle();
      if (error) return null;
      return (data as { display_name?: string | null } | null)?.display_name ?? null;
    },
  });

  if (!enabled) return null;
  const name = (data ?? "").trim();

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary",
        className,
      )}
    >
      <Crown className="h-3 w-3 shrink-0" />
      <span className="truncate">{name || "Unknown creator"}</span>
    </span>
  );
}
