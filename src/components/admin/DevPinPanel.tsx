import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unlockDevPin } from "@/lib/dev-pin.functions";
import { AdminSection } from "./AdminSection";

/** Boss → System → API keys: the dev.b055 sign-in shared by every OGSTREAMZ app. */
export function DevPinPanel() {
  const unlock = useServerFn(unlockDevPin);
  const run = useMutation({
    mutationFn: () => unlock(),
    onSuccess: () => toast.success("Dev PIN unlocked in every app."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't unlock it"),
  });
  return (
    <AdminSection
      icon={<LockOpen className="h-4 w-4 text-emerald-400" />}
      title="Dev sign-in (dev.b055)"
      subtitle="Sign in to any OGSTREAMZ app with the username dev.b055 and your 4-digit dev PIN as the password. The PIN is kept once, as the secret dev_b055_pin in your OGSTREAMZ database's Vault, and every app checks it there. 5 wrong PINs lock it for 15 minutes in every app; 20 in a day lock it until you unlock it here."
    >
      <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
        {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock dev PIN"}
      </Button>
    </AdminSection>
  );
}
