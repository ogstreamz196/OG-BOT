import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "./SettingsCard";

/**
 * Boss shortcut on Settings. Your own coins, VIP and roles are changed in
 * Members like anyone else's (search your name in the Boss search), so this
 * card no longer has its own copies of those switches.
 */
export function BossControls() {
  return (
    <SettingsCard
      icon={<ShieldCheck className="h-5 w-5" />}
      title="Boss controls"
      hint="Your coins, VIP and roles are changed in Members, like anyone else's."
      tone="violet"
    >
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
