import { Link } from "@tanstack/react-router";
import { LineChart, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useSetSignalsPortal, useSignalsPortal } from "@/hooks/use-signals-portal";
import { AdminSection } from "./AdminSection";

/** Boss switch for the OG Signals portal (home card and the /signals page). */
export function SignalsPortalPanel() {
  const { enabled, isLoading } = useSignalsPortal();
  const set = useSetSignalsPortal();
  return (
    <AdminSection
      icon={<LineChart className="h-5 w-5 text-primary" />}
      title="OG Signals portal"
      subtitle={
        <>
          {isLoading
            ? "Loading…"
            : enabled
              ? "On: members see the Signals card on home and can open the live board."
              : "Off: the card is hidden and members see a switched-off page. You can still open it."}{" "}
          <Link
            to="/signals"
            className="font-semibold text-foreground underline underline-offset-2"
          >
            Open the board
          </Link>
        </>
      }
      action={
        <div className="flex items-center gap-2">
          {set.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            checked={enabled}
            disabled={isLoading || set.isPending}
            onCheckedChange={(v) => set.mutate(v)}
            aria-label="Turn the OG Signals portal on or off"
          />
        </div>
      }
    />
  );
}
