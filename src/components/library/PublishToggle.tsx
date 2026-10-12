import { useState } from "react";
import { Globe, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";

type Props = {
  songId: string;
  isPublic: boolean;
  onChanged?: () => void;
};

/**
 * Owner-only control: tracks stay private in the creator's library until they
 * explicitly publish them to the global player.
 */
export function PublishToggle({ songId, isPublic, onChanged }: Props) {
  const [value, setValue] = useState(isPublic);
  const [saving, setSaving] = useState(false);

  async function update(next: boolean) {
    setValue(next);
    setSaving(true);
    try {
      const { error } = await supabase
        .from("songs")
        .update({ is_public: next } as never)
        .eq("id", songId);
      if (error) throw error;
      toast.success(next ? "Published to Community" : "Removed from Community");
      onChanged?.();
    } catch (e) {
      setValue(!next);
      toast.error(e instanceof Error ? e.message : "Could not update sharing");
    } finally {
      setSaving(false);
    }
  }

  return (
    <label
      htmlFor={`publish-${songId}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium shadow-card"
    >
      <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span aria-hidden className="mt-0.5 text-primary">
          {value ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </span>
        <span className="min-w-0 break-words leading-snug">
          <span className="block font-semibold">
            {value ? "Shared in Community" : "Private to your library"}
          </span>
          <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
            {value
              ? "Anyone can listen. Turn off to keep it private."
              : "Only you can listen. Turn on to share it."}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Switch
          id={`publish-${songId}`}
          checked={value}
          disabled={saving}
          onCheckedChange={update}
          aria-label={value ? "Remove from Community" : "Share to Community"}
          className="w-20"
        />
      </span>
    </label>
  );
}
