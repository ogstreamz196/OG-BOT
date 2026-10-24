import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, Loader2, Merge, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  findMergeCandidate,
  mergeAccounts,
  type MergeCandidate,
} from "@/lib/admin-merge-accounts.functions";

const LABELS: Record<string, string> = {
  songs: "tracks",
  unlocked_songs: "unlocks",
  song_brief_drafts: "song drafts",
  generation_attempts: "creation attempts",
  og_messages: "OG B0T chat messages",
  community_messages: "Battle Zone messages",
  telegram_sign_in_events: "Telegram events",
  coin_transactions: "coin history entries",
  payment_refunds: "refund records",
  sports_guide_access: "Sports Guide access",
  vip_pass_purchases: "Vault pass",
  vip_pass_credentials: "Vault login",
  referrals: "referrals",
  telegram: "Telegram link",
};

function Summary({ c, label }: { c: MergeCandidate; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3 text-sm">
      <p className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate font-semibold">{c.display_name || c.email || c.id}</p>
      <p className="truncate text-xs text-muted-foreground">{c.email}</p>
      <p className="mt-1.5 text-xs">
        {c.songs} tracks · {c.coin_balance} coins ·{" "}
        {c.telegram_linked
          ? `Telegram ${c.telegram_username ? "@" + c.telegram_username : "linked"}`
          : "No Telegram"}
        {c.roles.includes("vip") ? " · VIP" : ""}
        {c.activeSubscription ? " · Subscription" : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        Joined {new Date(c.created_at).toLocaleDateString()}
      </p>
    </div>
  );
}

/** Boss only: fold a duplicate account into this one. */
export function BossMergeCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const findFn = useServerFn(findMergeCandidate);
  const mergeFn = useServerFn(mergeAccounts);
  const [query, setQuery] = useState("");
  const [pair, setPair] = useState<{ primary: MergeCandidate; duplicate: MergeCandidate } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{
    moved: Record<string, number>;
    coinsMoved: number;
    notes: string[];
  } | null>(null);

  const find = useMutation({
    mutationFn: () => findFn({ data: { primaryId: userId, query } }),
    onSuccess: (r) => {
      setResult(null);
      if ("error" in r) {
        setPair(null);
        toast.error(r.error);
      } else setPair(r);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const merge = useMutation({
    mutationFn: () => mergeFn({ data: { primaryId: userId, duplicateId: pair!.duplicate.id } }),
    onSuccess: (r) => {
      setResult(r);
      setPair(null);
      setQuery("");
      setConfirmOpen(false);
      toast.success("Accounts merged");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmOpen(false);
    },
  });

  return (
    <section className="og-panel rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
      <header className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-muted">
          <Merge className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-semibold">Merge a duplicate account</h3>
          <p className="text-sm text-muted-foreground">
            Moves another account's tracks, coins, chats, Telegram link and referrals into this one.
            The emptied duplicate can then be deleted.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <Label htmlFor="merge-query">Duplicate's email, username or user ID</Label>
        <div className="flex gap-2">
          <Input
            id="merge-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim().length >= 2) find.mutate();
            }}
            placeholder="e.g. gaz@example.com or gaz123"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            disabled={query.trim().length < 2 || find.isPending}
            onClick={() => find.mutate()}
          >
            {find.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Find
          </Button>
        </div>
      </div>

      {pair ? (
        <div className="space-y-2">
          <Summary c={pair.duplicate} label="Duplicate (emptied)" />
          <div className="flex justify-center text-muted-foreground">
            <ArrowDown className="h-4 w-4" />
          </div>
          <Summary c={pair.primary} label="Main account (keeps everything)" />
          <Button
            type="button"
            className="w-full"
            disabled={pair.duplicate.roles.some((r) => ["boss", "admin", "dev"].includes(r))}
            onClick={() => {
              setConfirmText("");
              setConfirmOpen(true);
            }}
          >
            <Merge className="mr-2 h-4 w-4" /> Merge into this account
          </Button>
        </div>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-dashed border-border bg-background/40 p-3 text-sm">
          <p className="font-semibold">Merged</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {result.coinsMoved > 0 ? <li>{result.coinsMoved} coins</li> : null}
            {Object.entries(result.moved).map(([k, n]) => (
              <li key={k}>{k === "telegram" ? LABELS[k] : `${n} ${LABELS[k] ?? k}`}</li>
            ))}
            {result.coinsMoved === 0 && Object.keys(result.moved).length === 0 ? (
              <li>Nothing to move.</li>
            ) : null}
          </ul>
          {result.notes.length ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {result.notes.map((n) => (
                <li key={n}>⚠️ {n}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Check the duplicate is empty, then delete it from its own settings page.
          </p>
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge these accounts?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything moves from <b>{pair?.duplicate.display_name || pair?.duplicate.email}</b>{" "}
              into <b>{pair?.primary.display_name || pair?.primary.email}</b>. This can't be undone.
              Type MERGE to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="MERGE"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merge.isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={confirmText !== "MERGE" || merge.isPending}
              onClick={() => merge.mutate()}
            >
              {merge.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Merge accounts
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
