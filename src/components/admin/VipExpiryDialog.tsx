import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mode = "lifetime" | "months" | "custom";

export function useVipExpiry(userId: string, enabled = true) {
  return useQuery({
    queryKey: ["admin-vip-expiry", userId],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("expires_at" as never)
        .eq("user_id", userId)
        .eq("role", "vip")
        .maybeSingle();
      return ((data as { expires_at?: string | null } | null)?.expires_at ?? null) as
        | string
        | null;
    },
  });
}

export function formatVipExpiry(expiresAt: string | null | undefined) {
  if (!expiresAt) return "Lifetime";
  return `Until ${new Date(expiresAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function toUkDateInput(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Accepts DD/MM/YYYY (typed) or YYYY-MM-DD; returns a Date at 23:59:59 local, or null. */
function parseTypedDate(s: string): Date | null {
  const v = s.trim();
  let day: number, month: number, year: number;
  const uk = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (uk) {
    day = Number(uk[1]);
    month = Number(uk[2]);
    year = Number(uk[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 23, 59, 59);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function VipExpiryDialog({
  open,
  onOpenChange,
  userId,
  isVip,
  currentExpiry,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  isVip: boolean;
  currentExpiry?: string | null;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("months");
  const [months, setMonths] = useState("12");
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!open) return;
    if (isVip && !currentExpiry) setMode("lifetime");
    else if (isVip && currentExpiry) {
      setMode("custom");
      setCustom(toUkDateInput(new Date(currentExpiry)));
    } else setMode("months");
  }, [open, isVip, currentExpiry]);

  const mut = useMutation({
    mutationFn: async () => {
      let expires: string | null = null;
      if (mode === "months") {
        const d = new Date();
        d.setMonth(d.getMonth() + Number(months));
        expires = d.toISOString();
      } else if (mode === "custom") {
        const d = parseTypedDate(custom);
        if (!d) throw new Error("Type the date as DD/MM/YYYY");
        if (d.getTime() <= Date.now()) throw new Error("Date must be in the future");
        expires = d.toISOString();
      }
      const { error } = await supabase.rpc(
        "set_vip_expiry_admin" as never,
        {
          target_user_id: userId,
          new_expires_at: expires,
          admin_notes: isVip ? "boss_adjust_expiry" : "boss_grant_with_expiry",
        } as never,
      );
      if (error) throw new Error(error.message);
      return expires;
    },
    onSuccess: (expires) => {
      toast.success(`VIP ${isVip ? "updated" : "granted"} · ${formatVipExpiry(expires)}`);
      qc.invalidateQueries({ queryKey: ["admin-vip-expiry", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users-roles"] });
      qc.invalidateQueries({ queryKey: ["admin-user-roles", userId] });
      qc.invalidateQueries({ queryKey: ["user-roles", userId] });
      qc.invalidateQueries({ queryKey: ["admin-user-audit", userId] });
      qc.invalidateQueries({ queryKey: ["user-role"] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      const m = e.message.toLowerCase();
      if (m.includes("unauthorized")) toast.error("Not allowed.");
      else if (m.includes("expiry_in_past")) toast.error("Date must be in the future.");
      else toast.error(e.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            {isVip ? "Adjust VIP expiry" : "Grant VIP"}
          </DialogTitle>
          <DialogDescription>
            {isVip ? `Currently: ${formatVipExpiry(currentExpiry)}` : "How long should VIP last?"}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-3">
          <label className="flex items-center gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="lifetime" />
            <span className="text-sm font-medium">Lifetime</span>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="months" />
            <span className="text-sm font-medium">Length</span>
            <Select
              value={months}
              onValueChange={(v) => {
                setMonths(v);
                setMode("months");
              }}
            >
              <SelectTrigger className="ml-auto h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12">12 months</SelectItem>
                <SelectItem value="6">6 months</SelectItem>
                <SelectItem value="3">3 months</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="custom" />
            <span className="text-sm font-medium shrink-0">Custom date</span>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="DD/MM/YYYY"
              maxLength={10}
              className="ml-auto h-8 w-36 text-center"
              value={custom}
              onFocus={() => setMode("custom")}
              onChange={(e) => {
                const raw = e.target.value;
                const deleting = raw.length < custom.length;
                if (deleting || /[^\d/]/.test(raw) || raw.includes("-")) {
                  setCustom(raw);
                } else {
                  const d = raw.replace(/\D/g, "").slice(0, 8);
                  let out = d.slice(0, 2);
                  if (d.length >= 2) out += "/" + d.slice(2, 4);
                  if (d.length >= 4) out += "/" + d.slice(4);
                  setCustom(out);
                }
                setMode("custom");
              }}
            />
          </label>
        </RadioGroup>
        <Label className="sr-only">VIP expiry</Label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isVip ? "Save" : "Grant VIP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
