import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { UpgradeModal } from "@/components/UpgradeModal";

const DISMISS_KEY = "upgrade-banner-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isDismissed(): boolean {
  try {
    const ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    return Date.now() - Number(ts) < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function UpgradeBanner() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/user"], staleTime: 60_000 });
  const [dismissed, setDismissed] = useState(() => isDismissed());
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (!user || user.subscriptionTier !== "free" || dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-b border-amber-500/20 border-l-[3px] border-l-[#C96A3A] px-4 py-2 text-xs shrink-0">
        <button
          onClick={() => setUpgradeOpen(true)}
          className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors font-medium"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>You're on the free plan — <span className="underline underline-offset-2">upgrade for more suggestions & messages</span></span>
        </button>
        <button
          onClick={dismiss}
          className="text-amber-600/60 hover:text-amber-600 dark:text-amber-400/60 dark:hover:text-amber-400 transition-colors ml-1 shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </>
  );
}
