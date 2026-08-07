import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Calendar } from "lucide-react";
import { AILimitModal } from "./AILimitModal";
import { useToast } from "@/hooks/use-toast";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function WeeklyPlanAI({ onPlanGenerated }: { onPlanGenerated: (plan: any) => void }) {
  const [open, setOpen] = useState(false);
  const [dayConfigs, setDayConfigs] = useState<Record<string, 'normal'|'busy'|'off'>>({});
  const [showLimitModal, setShowLimitModal] = useState(false);
  const { toast } = useToast();

  const planMutation = useMutation({
    mutationFn: async (schedule: any[]) => {
      const res = await fetch("/api/ai/weekly-plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule }),
      });
      const data = await res.json();
      if (!res.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setOpen(false);
      onPlanGenerated(data.meals);
      toast({
        title: "Simmer filled your week",
        description: `Filled your week from your recipe library. ${data.callsRemaining != null ? `(${data.callsRemaining} suggestions left)` : ''}`,
      });
    },
    onError: (err: any) => {
      if (err.upgradePrompt) {
        setOpen(false);
        setShowLimitModal(true);
      } else {
        toast({ title: "Failed", description: err.error || "An unknown error occurred", variant: "destructive" });
      }
    }
  });

  const handleGenerate = () => {
    const schedule = DAYS_OF_WEEK.map(day => ({
      dayOfWeek: day,
      config: dayConfigs[day] || 'normal',
      isBusyDay: dayConfigs[day] === 'busy', // Backwards compat
      isOffDay: dayConfigs[day] === 'off',
      peopleHome: 3 // Assumed fixed household size per requirements
    }));
    planMutation.mutate(schedule);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) setDayConfigs({}); setOpen(v); }}>
        <DialogTrigger asChild>
          <Button className="bg-[#C96A3A] hover:bg-[#A85530] text-white shadow-md">
            <Sparkles className="w-4 h-4 mr-2" />
            Fill My Week
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-orange-500" />
              Configure Week
            </DialogTitle>
            <DialogDescription>
              Mark your busy days below. Simmer will suggest quicker recipes (under 30 minutes) for those days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {DAYS_OF_WEEK.map(day => (
              <div key={day} className="flex items-center justify-between">
                <Label htmlFor={`config-${day}`} className="text-base">{day}</Label>
                <Select value={dayConfigs[day] || 'normal'} onValueChange={(val: any) => setDayConfigs(prev => ({...prev, [day]: val}))}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="busy">Busy (&lt; 30 min)</SelectItem>
                    <SelectItem value="off">Eat Out / Off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={handleGenerate} disabled={planMutation.isPending} className="w-full sm:w-auto bg-[#C96A3A] hover:bg-[#A85530] text-white">
              {planMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                "Generate Plan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AILimitModal open={showLimitModal} onOpenChange={setShowLimitModal} />
    </>
  );
}
