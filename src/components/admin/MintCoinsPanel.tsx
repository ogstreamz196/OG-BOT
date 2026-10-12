import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Coins,
  Loader2,
  Plus,
  Minus,
  History,
  ChevronsUpDown,
  Check,
  User as UserIcon,
  Equal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { maskDevIdentity } from "@/lib/dev-identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UserAuditTrail } from "./UserAuditTrail";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";
import { ConfirmAction } from "./ConfirmAction";

interface ProfileLite {
  id: string;
  email: string | null;
  display_name: string | null;
  coin_balance: number;
}

interface MintTx {
  id: string;
  user_id: string;
  amount: number;
  type: string;
  reference: string | null;
  created_at: string;
  email?: string | null;
}

export function MintCoinsPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ProfileLite | null>(null);
  const [amount, setAmount] = useState("100");
  const [notes, setNotes] = useState("");

  const profilesQuery = useQuery({
    queryKey: ["admin-profiles-search"],
    queryFn: async (): Promise<ProfileLite[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, display_name, coin_balance")
        .order("email", { ascending: true })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as ProfileLite[]).map((p) => maskDevIdentity(p));
    },
  });

  const recent = useQuery({
    queryKey: ["admin-mint-history"],
    queryFn: async (): Promise<MintTx[]> => {
      const { data, error } = await supabase
        .from("coin_transactions")
        .select("id, user_id, amount, type, reference, created_at")
        .in("type", ["admin_mint", "mint", "admin_deduct"])
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      const list = (data ?? []) as MintTx[];
      const ids = Array.from(new Set(list.map((t) => t.user_id)));
      if (!ids.length) return list;
      const { data: profs } = await supabase.from("profiles").select("id, email").in("id", ids);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
      const map = new Map((profs ?? []).map((p: any) => [p.id, p.email]));
      return list.map((t) => ({ ...t, email: map.get(t.user_id) ?? null }));
    },
  });

  const mint = useMutation({
    mutationFn: async (signedAmount: number) => {
      if (!selected) throw new Error("Select a user first");
      if (!Number.isFinite(signedAmount) || signedAmount === 0)
        throw new Error("Amount must be a non-zero integer");

      const { data, error } = await supabase.rpc("mint_coins_admin", {
        target_user_id: selected.id,
        amount: Math.trunc(signedAmount),
        admin_notes: notes.trim() || (signedAmount > 0 ? "admin_mint" : "admin_deduct"),
      });
      if (error) throw new Error(error.message);
      return { newBalance: data as number, signedAmount };
    },
    onSuccess: ({ newBalance, signedAmount }) => {
      toast.success(
        `${signedAmount > 0 ? "Awarded" : "Deducted"} ${Math.abs(signedAmount)} coins · new balance ${newBalance}`,
      );
      qc.invalidateQueries({ queryKey: ["admin-mint-history"] });
      qc.invalidateQueries({ queryKey: ["admin-profiles-search"] });
      qc.invalidateQueries({ queryKey: ["admin-user-audit", selected?.id] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setNotes("");
      if (selected) setSelected({ ...selected, coin_balance: newBalance });
    },
    onError: (e: Error) => {
      const m = e.message.toLowerCase();
      if (m.includes("unauthorized")) toast.error("You're not allowed to mint coins.");
      else if (m.includes("target_not_found")) toast.error("User not found.");
      else if (m.includes("amount_must_be_nonzero")) toast.error("Amount can't be zero.");
      else if (m.includes("amount_out_of_range")) toast.error("Amount is out of range.");
      else toast.error(e.message);
    },
  });

  const setExact = useMutation({
    mutationFn: async (next: number) => {
      if (!selected) throw new Error("Select a user first");
      if (!Number.isFinite(next) || next < 0) throw new Error("Balance must be ≥ 0");
      const { data, error } = await supabase.rpc("set_balance_admin", {
        target_user_id: selected.id,
        new_balance: Math.trunc(next),
        admin_notes: notes.trim() || "admin_set_balance",
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (newBalance) => {
      toast.success(`Balance set to ${newBalance}`);
      qc.invalidateQueries({ queryKey: ["admin-mint-history"] });
      qc.invalidateQueries({ queryKey: ["admin-profiles-search"] });
      qc.invalidateQueries({ queryKey: ["admin-user-audit", selected?.id] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setNotes("");
      if (selected) setSelected({ ...selected, coin_balance: newBalance });
    },
    onError: (e: Error) => {
      const m = e.message.toLowerCase();
      if (m.includes("balance_out_of_range")) toast.error("Balance out of range.");
      else if (m.includes("unauthorized")) toast.error("Not allowed.");
      else if (m.includes("target_not_found")) toast.error("User not found.");
      else toast.error(e.message);
    },
  });

  const numericAmount = Number(amount);
  const validAmount = Number.isFinite(numericAmount) && numericAmount !== 0;
  const disabled = mint.isPending || !selected || !validAmount;

  const sortedProfiles = useMemo(
    () =>
      (profilesQuery.data ?? [])
        .slice()
        .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
    [profilesQuery.data],
  );

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Coins className="h-4 w-4 text-coin" />
        <h3 className="font-semibold">Award &amp; Mint coins</h3>
        <span className="ml-auto text-xs text-muted-foreground">Admin-only · server-verified</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1.4fr_0.7fr]">
        <div>
          <Label>User</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="mt-2 w-full justify-between font-normal"
              >
                {selected ? (
                  <span className="flex items-center gap-2 truncate">
                    <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selected.email ?? selected.id.slice(0, 8)}</span>
                    <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">
                      {selected.coin_balance} coins
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Search users by email or name…</span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command
                filter={(value, search) => {
                  if (!search) return 1;
                  return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                }}
              >
                <CommandInput placeholder="Search email or name…" />
                <CommandList>
                  {profilesQuery.isLoading ? (
                    <div className="grid place-items-center p-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        {sortedProfiles.map((p) => {
                          const label = `${p.email ?? ""} ${p.display_name ?? ""} ${p.id}`;
                          return (
                            <CommandItem
                              key={p.id}
                              value={label}
                              onSelect={() => {
                                setSelected(p);
                                setOpen(false);
                              }}
                              className="flex items-center gap-2"
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4",
                                  selected?.id === p.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">
                                  {p.email ?? p.id.slice(0, 8)}
                                </div>
                                {p.display_name && (
                                  <div className="truncate text-xs text-muted-foreground">
                                    {p.display_name}
                                  </div>
                                )}
                              </div>
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {p.coin_balance}
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <Label htmlFor="mint-amount">Amount</Label>
          <Input
            id="mint-amount"
            type="number"
            min={1}
            max={1000000}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2"
          />
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="mint-notes">Admin notes (saved with the transaction)</Label>
        <Textarea
          id="mint-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. promo grant, refund for failed batch, manual top-up"
          maxLength={200}
          className="mt-2 resize-none"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ConfirmAction
          tooltip={`Adds ${Math.abs(numericAmount || 0)} coins to this user's balance. Logged in the coin audit trail.`}
          title={`Award ${Math.abs(numericAmount || 0)} coins?`}
          confirmLabel="Award coins"
          description={
            <>
              <p>
                <b>{selected?.email ?? "No user selected"}</b> goes from{" "}
                <b>{selected?.coin_balance ?? 0}</b> to{" "}
                <b>{(selected?.coin_balance ?? 0) + Math.abs(numericAmount || 0)}</b> coins.
              </p>
              <p>This is written to the coin audit trail with your notes.</p>
            </>
          }
          onConfirm={() => mint.mutate(Math.abs(numericAmount))}
        >
          <Button disabled={disabled} className="bg-gradient-brand text-primary-foreground">
            {mint.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Award {Math.abs(numericAmount || 0)} coins
          </Button>
        </ConfirmAction>

        <ConfirmAction
          destructive
          tooltip={`Burns ${Math.abs(numericAmount || 0)} coins from this user's balance. This cannot be undone automatically.`}
          title={`Burn ${Math.abs(numericAmount || 0)} coins?`}
          confirmLabel="Burn coins"
          description={
            <>
              <p>
                <b>{selected?.email ?? "No user selected"}</b> goes from{" "}
                <b>{selected?.coin_balance ?? 0}</b> to{" "}
                <b>{Math.max(0, (selected?.coin_balance ?? 0) - Math.abs(numericAmount || 0))}</b>{" "}
                coins.
              </p>
              <p>Deductions are permanent — you'd have to award coins back manually.</p>
            </>
          }
          onConfirm={() => mint.mutate(-Math.abs(numericAmount))}
        >
          <Button variant="outline" disabled={disabled}>
            <Minus className="mr-2 h-4 w-4" />
            Deduct {Math.abs(numericAmount || 0)}
          </Button>
        </ConfirmAction>

        <ConfirmAction
          destructive
          tooltip="Overwrites the balance with this exact number, ignoring the current value. The delta is logged."
          title={`Set balance to exactly ${Math.abs(numericAmount || 0)}?`}
          confirmLabel="Overwrite balance"
          description={
            <p>
              <b>{selected?.email ?? "No user selected"}</b> currently has{" "}
              <b>{selected?.coin_balance ?? 0}</b> coins. This overwrites the balance to{" "}
              <b>{Math.abs(numericAmount || 0)}</b> and logs the difference.
            </p>
          }
          onConfirm={() => setExact.mutate(Math.abs(numericAmount))}
        >
          <Button
            variant="secondary"
            disabled={
              setExact.isPending ||
              !selected ||
              !Number.isFinite(numericAmount) ||
              numericAmount < 0
            }
          >
            {setExact.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Equal className="mr-2 h-4 w-4" />
            )}
            Set to {Math.abs(numericAmount || 0)}
          </Button>
        </ConfirmAction>
      </div>

      {selected && <UserAuditTrail userId={selected.id} email={selected.email} />}

      <CollapsiblePanel title="Recent admin changes (global)" className="mt-6">
        <div className="px-3 py-2">
          {recent.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : recent.data && recent.data.length > 0 ? (
            <ul className="divide-y divide-border text-sm">
              {recent.data.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.email ?? t.user_id.slice(0, 8)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.reference || t.type} · {new Date(t.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div
                    className={
                      t.amount >= 0
                        ? "font-semibold text-primary"
                        : "font-semibold text-destructive"
                    }
                  >
                    {t.amount >= 0 ? "+" : ""}
                    {t.amount}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No admin coin activity yet.</p>
          )}
        </div>
      </CollapsiblePanel>
    </div>
  );
}
