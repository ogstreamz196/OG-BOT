import { Copy, Crown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function OgVipIdCard({ id }: { id: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success("OG VIP ID copied");
    } catch {
      toast.error("Couldn't copy — write it down instead.");
    }
  };
  return (
    <div className="rounded-2xl border-2 border-coin/60 bg-coin/10 p-4 text-left shadow-glow">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-coin">
        <Crown className="h-4 w-4" /> OG VIP ID
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="font-mono text-3xl font-black tracking-widest">{id}</span>
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy className="mr-1 h-4 w-4" /> Copy
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Your yearly VIP verification code. Keep it safe for VIP access and support.
      </p>
    </div>
  );
}
