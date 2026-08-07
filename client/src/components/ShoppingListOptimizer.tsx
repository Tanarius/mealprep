import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { AILimitModal } from "./AILimitModal";
import { useToast } from "@/hooks/use-toast";

export function ShoppingListOptimizer({ 
  currentItems, 
  onOptimized 
}: { 
  currentItems: string[]; 
  onOptimized: (optimizedData: any) => void;
}) {
  const [showLimitModal, setShowLimitModal] = useState(false);
  const { toast } = useToast();

  const optMutation = useMutation({
    mutationFn: async (items: string[]) => {
      const res = await fetch("/api/ai/optimize-shopping-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listItems: items }),
      });
      const data = await res.json();
      if (!res.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      onOptimized(data.optimizedList);
      toast({
        title: "List Optimized",
        description: `Removed pantry duplicates and organized by aisle ${data.callsRemaining != null ? `(${data.callsRemaining} suggestions left)` : ''}`,
      });
    },
    onError: (err: any) => {
      if (err.upgradePrompt) {
        setShowLimitModal(true);
      } else {
        toast({ title: "Failed to optimize", description: err.error || "Unknown error", variant: "destructive" });
      }
    }
  });

  return (
    <>
      <Button 
        variant="secondary"
        className="w-full sm:w-auto bg-orange-600/10 hover:bg-orange-600/20 text-orange-600 dark:text-orange-400 border border-orange-500/20"
        onClick={() => optMutation.mutate(currentItems)}
        disabled={optMutation.isPending || currentItems.length === 0}
      >
        {optMutation.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Optimizing...</>
        ) : (
          <><Sparkles className="w-4 h-4 mr-2" /> Optimize List with Simmer</>
        )}
      </Button>
      <AILimitModal open={showLimitModal} onOpenChange={setShowLimitModal} />
    </>
  );
}
