import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { forgetMemories, listMyMemories, setMemoryEnabled } from "@/lib/og-memory.functions";
import { SettingRow, SettingsCard } from "./SettingsCard";

const KEY = ["og-memories"];

/** What OG Bot remembers about the member, with delete and an off switch. */
export function MemoryCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyMemories);
  const forgetFn = useServerFn(forgetMemories);
  const toggleFn = useServerFn(setMemoryEnabled);
  const q = useQuery({ queryKey: KEY, queryFn: () => listFn() });

  const forget = useMutation({
    mutationFn: (id?: string) => forgetFn({ data: { id } }),
    onSuccess: (_r, id) => {
      toast.success(id ? "Forgotten" : "OG Bot has forgotten everything");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => toggleFn({ data: { enabled } }),
    onSuccess: (_r, enabled) => {
      toast.success(enabled ? "Memory on" : "Memory off and cleared");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enabled = q.data?.enabled ?? true;
  const memories = q.data?.memories ?? [];

  return (
    <SettingsCard
      icon={<Brain className="h-5 w-5" />}
      title="OG Bot's memory"
      tone="teal"
      hint="Things you've told OG Bot in private chat, so it remembers you on any device."
    >
      <SettingRow
        label="Let OG Bot remember me"
        hint="Turning this off also wipes what it knows. Battle Zone never sees these."
      >
        <Switch
          aria-label="Let OG Bot remember me"
          checked={enabled}
          disabled={q.isLoading || toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v)}
        />
      </SettingRow>

      {q.isLoading ? (
        <div className="grid place-items-center py-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : enabled && memories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Tell OG Bot your team, your rap name or who your mates are and it'll
          remember.
        </p>
      ) : enabled ? (
        <>
          <ul className="flex flex-wrap gap-2">
            {memories.map((m) => (
              <li
                key={m.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background/40 py-1 pl-3 pr-1 text-xs"
              >
                <span className="truncate">{m.fact}</span>
                <button
                  type="button"
                  aria-label={`Forget: ${m.fact}`}
                  disabled={forget.isPending}
                  onClick={() => forget.mutate(m.id)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            disabled={forget.isPending}
            onClick={() => forget.mutate(undefined)}
          >
            Forget everything
          </Button>
        </>
      ) : null}
    </SettingsCard>
  );
}
