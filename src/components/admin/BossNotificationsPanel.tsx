import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  getBossNotifPrefs,
  updateBossNotifPrefs,
  sendTestBossNotification,
} from "@/lib/sign-in-tracking.functions";

type Prefs = Awaited<ReturnType<typeof getBossNotifPrefs>>;

export function BossNotificationsPanel() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery<Prefs>({
    queryKey: ["boss-notif-prefs"],
    queryFn: () => getBossNotifPrefs(),
  });
  const updateMut = useMutation({
    mutationFn: (data: Partial<NonNullable<Prefs>>) =>
      updateBossNotifPrefs({ data: data as never }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boss-notif-prefs"] }),
    onError: (e) => toast.error((e as Error).message || "Couldn't save that setting"),
  });
  const testMut = useMutation({
    mutationFn: () => sendTestBossNotification(),
    onSuccess: (r) =>
      r.ok ? toast.success("Test sent to your Telegram") : toast.error(r.reason ?? "Failed"),
    onError: (e) => toast.error((e as Error).message),
  });
  if (isLoading || !prefs) {
    return (
      <div className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading notification preferences…
      </div>
    );
  }

  const togglePref = (k: keyof NonNullable<Prefs>) => (val: boolean) => {
    updateMut.mutate({ [k]: val } as Partial<NonNullable<Prefs>>);
  };

  return (
    <div className="og-panel space-y-6 rounded-2xl border border-border bg-card/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Boss notifications</h3>
          <p className="text-sm text-muted-foreground">
            Non-sensitive Telegram alerts for new accounts and sign-ins.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending}
        >
          {testMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Send test DM
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PrefRow
          label="New signup"
          desc="DM when a brand-new account is created."
          icon={<Bell className="h-4 w-4 text-emerald-400" />}
          checked={prefs.notify_on_signup}
          onChange={togglePref("notify_on_signup")}
        />
        <PrefRow
          label="Every sign-in"
          desc="Noisy — DM on every successful login."
          icon={<Bell className="h-4 w-4 text-orange-400" />}
          checked={prefs.notify_every_signin}
          onChange={togglePref("notify_every_signin")}
        />
      </div>
    </div>
  );
}

function PrefRow({
  label,
  desc,
  icon,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  icon: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3 transition hover:bg-background/60">
      <div className="mt-0.5">{icon}</div>
      <div className="grow">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
