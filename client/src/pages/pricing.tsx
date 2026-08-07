import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Zap, Utensils, CalendarDays, ShoppingCart, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

export default function PricingPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/billing/create-checkout", { plan: "monthly" });
      const data = await res.json();
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      if (err?.status === 401) {
        setLocation("/auth");
        return;
      }
      toast({ title: "Couldn't start checkout", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#0a0a0c] selection:bg-orange-500/30 text-white pb-20">
      {/* Hero Section */}
      <div className="relative pt-20 pb-16 md:pt-32 md:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-900/30 via-[#0a0a0c] to-[#0a0a0c] pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-4 md:px-6 text-center z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-300 text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            <span>Good things simmer.</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-gray-400">
            Smarter planning for your household
          </h1>
          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto">
            Get intelligent recipe suggestions, optimize your grocery trips, and automate your week with Simmer.
          </p>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-5xl mx-auto px-4 md:px-6 relative z-10">
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          
          {/* Free Tier */}
          <div className="relative flex flex-col p-8 rounded-3xl bg-white/[0.02] border border-white/10 hover:bg-white/[0.04] transition-colors">
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-white mb-2">Basic</h3>
              <p className="text-gray-400">Everything you need to organize meals.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight text-white">$0</span>
                <span className="text-gray-500 font-medium">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-8 flex-1">
              {[
                { label: "10 suggestions / day", icon: <Zap className="w-5 h-5 text-gray-400" /> },
                { label: "30 assistant messages / day", icon: <MessageSquare className="w-5 h-5 text-gray-400" /> },
                { label: "Shared household pantry", icon: <Utensils className="w-5 h-5 text-gray-400" /> },
                { label: "Manual weekly planner", icon: <CalendarDays className="w-5 h-5 text-gray-400" /> },
                { label: "Basic shopping list", icon: <ShoppingCart className="w-5 h-5 text-gray-400" /> },
                { label: "Save unlimited recipes", icon: <Check className="w-5 h-5 text-gray-400" /> },
              ].map((feat, i) => (
                <li key={i} className="flex items-center gap-3 text-gray-300">
                  {feat.icon}
                  <span>{feat.label}</span>
                </li>
              ))}
            </ul>
            <Button 
              variant="outline" 
              className="w-full py-6 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-white"
              onClick={() => setLocation("/")}
            >
              Current Plan
            </Button>
          </div>

          {/* Premium Tier */}
          <div className="relative flex flex-col p-8 rounded-3xl bg-gradient-to-b from-orange-900/40 to-black border border-orange-500/30 shadow-[0_0_40px_-10px_rgba(201,106,58,0.3)]">
            <div className="absolute top-0 right-8 transform -translate-y-1/2">
              <span className="bg-[#C96A3A] text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                Most Popular
              </span>
            </div>
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-white mb-2">Premium</h3>
              <p className="text-orange-200">The ultimate meal planning assistant.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight text-white">$4.99</span>
                <span className="text-orange-300/60 font-medium">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-8 flex-1">
              {[
                { label: "Unlimited suggestions & assistant messages", icon: <Sparkles className="w-5 h-5 text-orange-400" /> },
                { label: "Generate 1-click weekly plans", icon: <Sparkles className="w-5 h-5 text-orange-400" /> },
                { label: "Auto-categorized groceries", icon: <Sparkles className="w-5 h-5 text-orange-400" /> },
                { label: "Nutrition & macros data", icon: <Check className="w-5 h-5 text-orange-400" /> },
                { label: "Priority recipe suggestions", icon: <Check className="w-5 h-5 text-orange-400" /> },
              ].map((feat, i) => (
                <li key={i} className="flex items-center gap-3 text-white font-medium">
                  {feat.icon}
                  <span>{feat.label}</span>
                </li>
              ))}
            </ul>
            <Button
              className="w-full py-6 rounded-xl bg-[#C96A3A] hover:bg-[#A85530] text-white font-semibold text-lg hover:scale-[1.02] transition-all shadow-lg border-0"
              onClick={handleUpgrade}
              disabled={loading}
            >
              {loading ? "Opening checkout…" : "Get Premium"}
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}
