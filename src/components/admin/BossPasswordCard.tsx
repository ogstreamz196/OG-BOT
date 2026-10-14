import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Wand2 } from "lucide-react";
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
import { setUserPassword } from "@/lib/admin-set-password.functions";
import { ConfirmAction } from "@/components/admin/ConfirmAction";

/** Easy to read out or type: no 0/O, 1/l/I. */
function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => chars[n % chars.length]).join("");
}

/** Boss only: set any new sign-in password for a member, then copy it to hand over. */
export function BossPasswordCard({ userId, name }: { userId: string; name: string }) {
  const setPasswordFn = useServerFn(setUserPassword);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastSet, setLastSet] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => setPasswordFn({ data: { userId, password } }),
    onSuccess: () => {
      toast.success(`New password set for ${name}`);
      setLastSet(password);
      setPassword("");
      setConfirmOpen(false);
    },
    onError: (e: Error) => {
      toast.error(e.message || "Couldn't change the password.");
      setConfirmOpen(false);
    },
  });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Password copied");
    } catch {
      toast.error("Couldn't copy. Select it and copy by hand.");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
      <header className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-muted">
          <KeyRound className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-semibold">Password</h3>
          <p className="text-sm text-muted-foreground">
            Set a new sign-in password for this member. Their old password stops working straight
            away.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <Label htmlFor="boss-new-password">New password</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Input
              id="boss-new-password"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              maxLength={72}
              placeholder="Type any password"
              className="pr-11 font-mono"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPassword(generatePassword());
                setShow(true);
              }}
            >
              <Wand2 className="mr-2 h-4 w-4" /> Generate
            </Button>
            <Button
              type="button"
              disabled={!password || save.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Set password
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The change is logged in the Boss audit trail. The password itself is never stored there.
        </p>
      </div>

      {lastSet ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-background/40 p-3 text-sm">
          <span className="text-muted-foreground">New password:</span>
          <span className="font-mono font-semibold">{lastSet}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => copy(lastSet)}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLastSet(null)}>
            Hide
          </Button>
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change {name}'s password?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll need the new password next time they sign in with email. Make sure you can
              pass it on to them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>Cancel</AlertDialogCancel>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Set new password
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Compact version for the users list "Edit" panel. */
export function BossPasswordInline({ userId, name }: { userId: string; name: string }) {
  const setPasswordFn = useServerFn(setUserPassword);
  const [password, setPassword] = useState("");
  const [lastSet, setLastSet] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string) => setPasswordFn({ data: { userId, password: value } }),
    onSuccess: (_r, value) => {
      toast.success(`New password set for ${name}`);
      setLastSet(value);
      setPassword("");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't change the password."),
  });

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`pw-${userId}`} className="flex items-center gap-1.5 text-xs">
        <KeyRound className="h-3 w-3" /> Set a new password
      </Label>
      <div className="flex gap-1.5">
        <Input
          id={`pw-${userId}`}
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          maxLength={72}
          placeholder="Any password"
          className="font-mono"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="shrink-0"
          aria-label="Generate a password"
          title="Generate a password"
          onClick={() => setPassword(generatePassword())}
        >
          <Wand2 className="h-4 w-4" />
        </Button>
        <ConfirmAction
          title={`Change ${name}'s password?`}
          description={
            <p>
              They'll need the new password next time they sign in with email. Make sure you can
              pass it on to them.
            </p>
          }
          confirmLabel="Set new password"
          tooltip="Replace this member's sign-in password"
          onConfirm={() => save.mutateAsync(password).then(() => undefined)}
        >
          <Button size="sm" disabled={!password || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
          </Button>
        </ConfirmAction>
      </div>
      {lastSet ? (
        <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-xs">
          <span className="min-w-0 flex-1 truncate font-mono">{lastSet}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() =>
              navigator.clipboard
                .writeText(lastSet)
                .then(() => toast.success("Password copied"))
                .catch(() => toast.error("Couldn't copy"))
            }
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
