import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2, Minus, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { adjustCoinsAsBoss } from "@/lib/admin-coins";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsCard } from "./SettingsCard";

/** The Boss's own coin and role controls, shown at the foot of Settings. */
export function BossControls() {
  const { user } = useAuth();
  const { data: profile, refetch } = useProfile();
  const { hasVipRole } = useRole();
  const qc = useQueryClient();
  const [balance, setBalance] = useState("");
  const [balanceDirty, setBalanceDirty] = useState(false);
  const [adjust, setAdjust] = useState("");

  useEffect(() => {
    if (profile && !balanceDirty) setBalance(String(profile.coin_balance ?? 0));
  }, [profile?.coin_balance, balanceDirty]);

  const saveBalance = useMutation({
    mutationFn: async () => {
      const n = Number.parseInt(balance, 10);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid balance");
      const { data, error } = await supabase.rpc("set_balance_admin", {
        target_user_id: user!.id,
        new_balance: n,
        admin_notes: "self_settings_set",
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: () => {
      toast.success("Balance set");
      setBalanceDirty(false);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustCoins = useMutation({
    mutationFn: async (delta: number) => {
      if (!Number.isFinite(delta) || delta === 0) throw new Error("Enter a non-zero amount");
      const { newBalance, applied } = await adjustCoinsAsBoss(
        user!.id,
        delta,
        "self_settings_adjust",
      );
      return { newBal: newBalance, delta: applied };
    },
    onSuccess: ({ newBal, delta }) => {
      toast.success(`${delta > 0 ? "+" : ""}${delta} coins · ${newBal}`);
      setAdjust("");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleVip = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase.rpc(
        "set_vip_admin" as never,
        {
          target_user_id: user!.id,
          admin_notes: "self_settings_toggle",
          make_vip: value,
        } as never,
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-role", user?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SettingsCard
      icon={<ShieldCheck className="h-5 w-5" />}
      title="Boss controls"
      hint="Only you can see this. Your own coins and roles."
      tone="violet"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="set-bal">Set my balance</Label>
          <div className="flex gap-2">
            <Input
              id="set-bal"
              type="number"
              min={0}
              value={balance}
              onChange={(e) => {
                setBalance(e.target.value);
                setBalanceDirty(true);
              }}
            />
            <Button
              onClick={() => saveBalance.mutate()}
              disabled={!balanceDirty || saveBalance.isPending}
            >
              {saveBalance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Set
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adj-bal">Adjust by</Label>
          <div className="flex gap-2">
            <Input
              id="adj-bal"
              type="number"
              min={1}
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
              placeholder="0"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Add coins"
              onClick={() => adjustCoins.mutate(Number.parseInt(adjust, 10))}
              disabled={!adjust || adjustCoins.isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Subtract coins"
              onClick={() => adjustCoins.mutate(-Number.parseInt(adjust, 10))}
              disabled={!adjust || adjustCoins.isPending}
            >
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <SettingRow
        label={
          <span className="inline-flex items-center gap-1.5">
            <Crown className="h-4 w-4 text-coin" /> VIP on my account
          </span>
        }
        hint="Premium tiers and bonus features."
      >
        {toggleVip.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Switch
          aria-label="VIP on my account"
          checked={hasVipRole}
          disabled={toggleVip.isPending}
          onCheckedChange={(v) => toggleVip.mutate(v)}
        />
      </SettingRow>
      <SettingRow label="Boss" hint="Another Boss can change this from Members.">
        <Switch checked disabled aria-label="Boss" />
      </SettingRow>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin">Boss console</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/users">Manage members</Link>
        </Button>
      </div>
    </SettingsCard>
  );
}
