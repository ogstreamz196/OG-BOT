import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteUserAccount } from "@/lib/admin-delete-account.functions";

/** One delete flow for every Boss screen: type DELETE, then it's gone. */
export function DeleteAccountDialog({
  userId,
  name,
  onDeleted,
  children,
}: {
  userId: string;
  name: string;
  onDeleted?: () => void;
  /** The trigger button. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteUserAccount);
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("Account deleted");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-users-list"] });
      onDeleted?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (remove.isPending) return;
        setOpen(v);
        if (!v) setTyped("");
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the account, tracks, coins and linked data. It can't be undone.
            Type DELETE to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Label htmlFor={`confirm-delete-${userId}`}>Confirmation</Label>
        <Input
          id={`confirm-delete-${userId}`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={typed !== "DELETE" || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Permanently delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
