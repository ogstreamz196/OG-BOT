import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFreeAccess, useSetFreeAccess } from "@/hooks/use-free-access";

const PRESETS: { label: string; hours: number }[] = [
  { label: "+1h", hours: 1 },
  { label: "+24h", hours: 24 },
  { label: "+7d", hours: 24 * 7 },
];

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRemaining(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h left`;
  return `${Math.round(hrs / 24)}d left`;
}

export function FreeAccessPanel() {
  const { enabled, rawEnabled, expiresAt, expired, isLoading } = useFreeAccess();
  const mut = useSetFreeAccess();

  const [draftExpiry, setDraftExpiry] = useState<string>(() => toLocalInputValue(expiresAt));

  useEffect(() => {
    setDraftExpiry(toLocalInputValue(expiresAt));
  }, [expiresAt]);

  const remaining = useMemo(() => formatRemaining(expiresAt), [expiresAt]);

  const applyPreset = (hours: number) => {
    const d = new Date(Date.now() + hours * 3600_000);
    setDraftExpiry(toLocalInputValue(d.toISOString()));
  };

  const draftIso = draftExpiry ? new Date(draftExpiry).toISOString() : null;

  const onToggle = (v: boolean) => {
    mut.mutate({ enabled: v, expiresAt: v ? draftIso : null });
  };

  const onSaveExpiry = () => {
    mut.mutate({ enabled: rawEnabled, expiresAt: draftIso });
  };

  const onClearExpiry = () => {
    setDraftExpiry("");
    mut.mutate({ enabled: rawEnabled, expiresAt: null });
  };

  return (
    <section className="og-panel mb-6 rounded-2xl border border-primary/30 bg-primary/[0.05] p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="font-semibold">Free access for all users</h3>
            <p className="text-sm text-muted-foreground">
              Limited-time promo: every signed-in user gets VIP-only features, including 0G B0T
              foul-mouth mode. Turn off to restore VIP-only access.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Status:{" "}
              <span
                className={
                  enabled
                    ? "text-emerald-400 font-medium"
                    : expired && rawEnabled
                      ? "text-amber-400 font-medium"
                      : "text-muted-foreground"
                }
              >
                {isLoading
                  ? "loading…"
                  : enabled
                    ? "ON — everyone unlocked"
                    : expired && rawEnabled
                      ? "AUTO-OFF — expiry reached"
                      : "OFF — VIP only"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mut.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            checked={enabled}
            disabled={isLoading || mut.isPending}
            onCheckedChange={onToggle}
            aria-label="Toggle free access for all users"
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-primary" />
          Auto-revert expiry (optional)
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a date/time when free access automatically reverts to VIP-only. Leave empty for no
          expiry.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="grow min-w-[220px]">
            <Label htmlFor="free-access-expiry" className="text-xs">
              Expires at
            </Label>
            <Input
              id="free-access-expiry"
              type="datetime-local"
              value={draftExpiry}
              onChange={(e) => setDraftExpiry(e.target.value)}
              disabled={mut.isPending}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyPreset(p.hours)}
                disabled={mut.isPending}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onSaveExpiry}
              disabled={mut.isPending || !draftExpiry}
            >
              Save expiry
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClearExpiry}
              disabled={mut.isPending || (!expiresAt && !draftExpiry)}
            >
              Clear
            </Button>
          </div>
        </div>

        {expiresAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Current expiry: {new Date(expiresAt).toLocaleString()}
            {remaining ? ` · ${remaining}` : ""}
          </p>
        )}
      </div>
    </section>
  );
}
