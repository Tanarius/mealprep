import { useState } from "react";
import { Sparkles, Zap, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  reason?: string; // e.g. "You've used your 10 free AI messages today."
}

// Every perk here is genuinely tier-differentiated — enforced server-side, not just copy.
const PERKS = [
  "500 recipe suggestions / month (free: 30)",
  "1,000 assistant messages / month (free: 100)",
  "100 screenshot imports / month (free: 10)",
  "Up to 6 household members (free: 2)",
  "Full activity feed history",
];

export function UpgradeModal({ open, onClose, reason }: UpgradeModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    // Funnel analytics — fire-and-forget, never blocks checkout
    apiRequest("POST", "/api/events", { event: "upgrade_clicked", properties: { source: "upgrade_modal" } }).catch(() => {});
    try {
      const res = await apiRequest("POST", "/api/billing/create-checkout", { plan: "monthly" });
      const data = await res.json();
      if (data.error) {
        toast({ title: "Couldn't start checkout", description: data.error, variant: "destructive" });
        return;
      }
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      toast({ title: "Couldn't start checkout", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            Upgrade to Premium
          </DialogTitle>
        </DialogHeader>

        {reason && (
          <p className="text-sm text-muted-foreground -mt-1">{reason}</p>
        )}

        {/* Perks list */}
        <ul className="space-y-1.5 mt-1">
          {PERKS.map((perk) => (
            <li key={perk} className="flex items-center gap-2 text-sm">
              <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              {perk}
            </li>
          ))}
        </ul>

        {/* Pricing */}
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className={cn(
            "mt-2 w-full rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-center transition-colors hover:border-amber-500/70 hover:bg-amber-500/10",
            loading && "opacity-60 cursor-wait"
          )}
        >
          <p className="font-semibold text-base">$4.99 / month</p>
          <p className="text-xs text-muted-foreground mt-0.5">Cancel anytime</p>
        </button>

        <p className="text-[11px] text-center text-muted-foreground">
          One subscription covers your entire household. Powered by Stripe — cancel anytime.
        </p>
      </DialogContent>
    </Dialog>
  );
}
