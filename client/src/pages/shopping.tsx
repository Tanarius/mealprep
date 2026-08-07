import { useState, useMemo, useEffect, useRef } from "react";
import {
  ShoppingCart, Plus, Trash2, Check, Sprout, Beef, Milk,
  Snowflake, Croissant, Package, Wheat, ChefHat,
  Clipboard, Download, X, Loader2, Sparkles, RefreshCw, Cookie
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WeeklyPlan } from "@shared/schema";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { computeSyncKey, syncRecipeItemsToShoppingList } from "@/lib/shoppingSync";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AILimitModal } from "@/components/AILimitModal";
import { InstacartLogo, WalmartLogo, AmazonLogo } from "@/components/BrandLogos";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersistentItem {
  id: number;
  name: string;
  amount: string | null;
  unit: string | null;
  category: string;
  checked: boolean;
  source: string | null;
  productData: string | null;
}


// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: React.ReactNode; label: string; order: number }> = {
  produce:    { icon: <Sprout className="h-3.5 w-3.5" />,   label: "Produce",           order: 1 },
  protein:    { icon: <Beef className="h-3.5 w-3.5" />,     label: "Protein & Meat",    order: 2 },
  dairy:      { icon: <Milk className="h-3.5 w-3.5" />,     label: "Dairy & Eggs",      order: 3 },
  frozen:     { icon: <Snowflake className="h-3.5 w-3.5" />,label: "Frozen",            order: 4 },
  bakery:     { icon: <Croissant className="h-3.5 w-3.5" />,label: "Bakery",            order: 5 },
  grains:     { icon: <Wheat className="h-3.5 w-3.5" />,    label: "Grains & Pasta",    order: 6 },
  condiments: { icon: <ChefHat className="h-3.5 w-3.5" />,  label: "Condiments",        order: 7 },
  pantry:     { icon: <Package className="h-3.5 w-3.5" />,  label: "Pantry",            order: 8 },
  snacks:     { icon: <Cookie className="h-3.5 w-3.5" />,   label: "Snacks & Drinks",   order: 9 },
  other:      { icon: <Package className="h-3.5 w-3.5" />,  label: "Other",             order: 10 },
};

// Store brand buttons — SVG inline icons
function InstacartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
    </svg>
  );
}

const STORES = [
  {
    name: "Instacart",
    shortName: "Instacart",
    bg: "bg-[#43b02a]",
    text: "text-white",
    buildUrl: (q: string) => `https://www.instacart.com/store/search_v3/term/${encodeURIComponent(q)}`,
    Logo: () => <InstacartLogo className="h-4 w-4" />,
  },
  {
    name: "Walmart",
    shortName: "Walmart",
    bg: "bg-[#0071dc]",
    text: "text-white",
    buildUrl: (q: string) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
    Logo: () => <WalmartLogo className="h-4 w-4" />,
  },
  {
    name: "Amazon Fresh",
    shortName: "Amazon",
    bg: "bg-[#232f3e]",
    text: "text-[#ff9900]",
    buildUrl: (q: string) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=amazonfresh`,
    Logo: () => <AmazonLogo className="h-4 w-5" />,
  },
];

function getMondayOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

// ── Item Row ──────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  onToggle,
  onDelete,
  isMobile,
}: {
  item: PersistentItem;
  onToggle: (id: number, checked: boolean) => void;
  onDelete: (id: number) => void;
  isMobile: boolean;
}) {
  const [storeOpen, setStoreOpen] = useState(false);
  const product = useMemo(() => {
    if (!item.productData) return null;
    try { return JSON.parse(item.productData); } catch { return null; }
  }, [item.productData]);

  const searchTerm = product?.brand ? `${product.brand} ${item.name}` : item.name;
  const qty = [item.amount, item.unit].filter(Boolean).join(" ");

  return (
    <div className={cn("group transition-opacity duration-300", item.checked && "opacity-50")}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        {/* Product thumbnail */}
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {product?.imageUrl
            ? <img src={product.imageUrl} alt={item.name} className="w-full h-full object-contain" />
            : <span className="text-muted-foreground/60">
                {CATEGORY_META[item.category]?.icon ?? <Package className="h-3.5 w-3.5" />}
              </span>
          }
        </div>

        {/* Checkbox */}
        <button
          onClick={() => onToggle(item.id, !item.checked)}
          className={cn(
            "w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded border-2 flex items-center justify-center transition-all duration-200",
            item.checked ? "bg-primary border-primary scale-110" : "border-border hover:border-primary"
          )}
        >
          {item.checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
        </button>

        {/* Name + qty */}
        <div className="flex-1 min-w-0 leading-tight">
          <span className={cn("text-sm transition-all duration-300", item.checked && "line-through text-muted-foreground")}>
            {item.name}
          </span>
          {qty && <span className="text-xs text-muted-foreground ml-1.5">{qty}</span>}
          {product?.brand && <p className="text-[11px] text-muted-foreground truncate leading-none mt-0.5">{product.brand}</p>}
        </div>

        {/* Desktop: store icons always visible + delete */}
        {!isMobile && (
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {STORES.map(store => (
              <Tooltip key={store.name}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => window.open(store.buildUrl(searchTerm), "_blank", "noopener")}
                    className={cn("h-6 w-6 rounded-md flex items-center justify-center transition-opacity", store.bg, store.text)}
                  >
                    <store.Logo />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Search on {store.name}</TooltipContent>
              </Tooltip>
            ))}
            <button onClick={() => onDelete(item.id)} className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Mobile: tap to open store sheet */}
        {isMobile && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setStoreOpen(v => !v)}
              className="h-7 w-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground"
            >
              <ShoppingCart className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onDelete(item.id)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Mobile store links expand */}
      {isMobile && storeOpen && (
        <div className="flex gap-2 px-3 pb-2">
          {STORES.map(store => (
            <button
              key={store.name}
              onClick={() => { window.open(store.buildUrl(searchTerm), "_blank", "noopener"); setStoreOpen(false); }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-1 justify-center", store.bg, store.text)}
            >
              <store.Logo />
              {store.shortName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Plan → shopping-list sync (computeSyncKey + syncRecipeItemsToShoppingList) lives in
// @/lib/shoppingSync so it can be unit-tested without a DOM/React test environment.

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ShoppingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const weekStart = getMondayOfWeek();
  const [newItem, setNewItem] = useState("");
  const [copied, setCopied] = useState(false);
  const [aiLimitOpen, setAiLimitOpen] = useState(false);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState("");
  const [hasSentCopilot, setHasSentCopilot] = useState(false);
  const [copilotRemaining, setCopilotRemaining] = useState<number | null>(null);
  const [copilotSessionId] = useState(() => `shopping-${Date.now()}`);
  const copilotInputRef = useRef<HTMLInputElement>(null);
  const lastSyncedPlanRef = useRef<string | null>(null);

  // Detect mobile
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: items = [], isLoading } = useQuery<PersistentItem[]>({
    queryKey: ["/api/snacks/shopping"],
    queryFn: () => fetch("/api/snacks/shopping", { credentials: "include" }).then(r => r.json()),
    refetchInterval: false,
  });

  const { data: plan } = useQuery<WeeklyPlan>({
    queryKey: ["/api/plans", weekStart],
  });

  // ── Auto-sync from plan whenever plan changes ────────────────────────────────
  // Delegates to the shared, atomic syncRecipeItemsToShoppingList. The localStorage key
  // (keyed on week + plan content) ensures each distinct plan state syncs once.
  useEffect(() => {
    if (!plan?.meals || items === undefined) return;

    const syncKey = computeSyncKey(weekStart, plan.meals);
    if (lastSyncedPlanRef.current === syncKey) return; // already ran for this exact plan state
    if (localStorage.getItem(syncKey)) { lastSyncedPlanRef.current = syncKey; return; }

    lastSyncedPlanRef.current = syncKey;

    syncRecipeItemsToShoppingList({
      planMeals: plan.meals, existingItems: items, syncKey, queryClient, toast, trigger: "auto",
    }).then(result => {
      // On failure the sync key isn't written; clear the in-memory guard too so a later
      // re-render / plan change retries (the refresh button is the manual retry path).
      if (!result.ok) lastSyncedPlanRef.current = null;
    });
  }, [plan?.meals, items, weekStart, queryClient, toast]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: ({ id, checked }: { id: number; checked: boolean }) =>
      fetch(`/api/snacks/shopping/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ checked }),
      }).then(r => r.json()),
    onMutate: async ({ id, checked }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/snacks/shopping"] });
      const prev = queryClient.getQueryData<PersistentItem[]>(["/api/snacks/shopping"]);
      queryClient.setQueryData<PersistentItem[]>(["/api/snacks/shopping"],
        old => (old ?? []).map(i => i.id === id ? { ...i, checked } : i));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(["/api/snacks/shopping"], ctx.prev); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/snacks/shopping/${id}`, { method: "DELETE", credentials: "include" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/snacks/shopping"] }),
  });

  const addItemMutation = useMutation({
    mutationFn: (name: string) => fetch("/api/snacks/shopping", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ name }),
    }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/snacks/shopping"] }); setNewItem(""); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const clearCheckedMutation = useMutation({
    mutationFn: () => fetch("/api/snacks/shopping?checked=true", { method: "DELETE", credentials: "include" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/snacks/shopping"] }),
  });

  const aiOptimizeMutation = useMutation({
    mutationFn: async () => {
      const itemStrings = unchecked.map(i => {
        const qty = [i.amount, i.unit].filter(Boolean).join(" ");
        return qty ? `${i.name} (${qty})` : i.name;
      });
      const res = await fetch("/api/ai/optimize-shopping-list", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ listItems: itemStrings }),
      });
      const data = await res.json();
      if (!res.ok) throw data;
      return data;
    },
    onSuccess: () => toast({ title: "List optimized", description: "Pantry dupes removed, aisle order applied", duration: 3000 }),
    onError: (err: any) => {
      if (err.upgradePrompt) setAiLimitOpen(true);
      else toast({ title: "Optimize failed", description: err.error ?? "Unknown error", variant: "destructive" });
    },
  });

  // ── Manual re-sync (refresh button) — safe retry of the atomic plan sync ──────
  const manualSync = async () => {
    if (!plan?.meals) { toast({ title: "No plan this week" }); return; }
    const syncKey = computeSyncKey(weekStart, plan.meals);
    // Act as a fresh retry: clear the in-memory guard, then run the same atomic sync the
    // auto-sync effect uses. Writing syncKey on success stops the effect re-running it.
    lastSyncedPlanRef.current = null;
    await syncRecipeItemsToShoppingList({
      planMeals: plan.meals, existingItems: items, syncKey, queryClient, toast, trigger: "manual",
    });
  };

  // ── Export ─────────────────────────────────────────────────────────────────

  const buildText = () => {
    const lines = ["SHOPPING LIST", ""];
    for (const [cat, catItems] of Object.entries(grouped)) {
      lines.push(`── ${CATEGORY_META[cat]?.label ?? cat} ──`);
      catItems.forEach(i => {
        const qty = [i.amount, i.unit].filter(Boolean).join(" ");
        lines.push(qty ? `${i.name}: ${qty}` : i.name);
      });
      lines.push("");
    }
    return lines.join("\n");
  };

  const copyList = () => {
    navigator.clipboard.writeText(buildText()).then(() => {
      setCopied(true); toast({ title: "Copied!" });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const exportTxt = () => {
    const blob = new Blob([buildText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `shopping-${weekStart}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Derived data ───────────────────────────────────────────────────────────

  const unchecked = items.filter(i => !i.checked);
  const checkedItems = items.filter(i => i.checked);

  const grouped = useMemo(() => {
    const order = ["produce","protein","dairy","frozen","bakery","grains","condiments","pantry","snacks","other"];
    const g: Record<string, PersistentItem[]> = {};
    for (const item of unchecked) {
      const k = item.category ?? "other";
      if (!g[k]) g[k] = [];
      g[k].push(item);
    }
    return Object.fromEntries(order.filter(k => g[k]).map(k => [k, g[k]]));
  }, [unchecked]);

  const totalUnchecked = unchecked.length;

  // ── Copilot quick-add ──────────────────────────────────────────────────────

  async function handleCopilotSubmit(overrideText?: string) {
    const message = (overrideText ?? copilotInput).trim();
    if (!message || copilotLoading) return;
    if (overrideText) setCopilotInput(overrideText);
    setHasSentCopilot(true);
    setCopilotLoading(true);
    setCopilotError("");
    try {
      const res = await apiRequest("POST", "/api/ai/copilot/chat", {
        content: message,
        sessionId: copilotSessionId,
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data?.callsRemaining === "number") setCopilotRemaining(data.callsRemaining);
      queryClient.invalidateQueries({ queryKey: ["/api/snacks/shopping"] });
      setCopilotInput("");
    } catch (err: any) {
      if (err?.status === 429) setAiLimitOpen(true);
      else setCopilotError("Couldn't reach Simmer — try again.");
    } finally {
      setCopilotLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky header ── */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-3 space-y-2.5">
        {/* Title row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold">Shopping List</h1>
            {totalUnchecked > 0 && (
              <Badge variant="secondary" className="text-xs tabular-nums">{totalUnchecked}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* AI Optimize */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-orange-500 hover:bg-orange-500/10"
                  onClick={() => aiOptimizeMutation.mutate()}
                  disabled={aiOptimizeMutation.isPending || unchecked.length === 0}
                >
                  {aiOptimizeMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Sparkles className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Optimize list (remove dupes, sort by aisle)</TooltipContent>
            </Tooltip>
            {/* Re-sync from plan */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={manualSync}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Re-sync from this week's plan</TooltipContent>
            </Tooltip>
            {/* Copy */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyList} disabled={items.length === 0}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Clipboard className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy list</TooltipContent>
            </Tooltip>
            {/* Export */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={exportTxt} disabled={items.length === 0}>
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export .txt</TooltipContent>
            </Tooltip>
            {/* Clear checked */}
            {checkedItems.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" onClick={() => clearCheckedMutation.mutate()}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear {checkedItems.length} checked</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Add item */}
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (newItem.trim()) addItemMutation.mutate(newItem.trim()); }}>
          <Input
            placeholder="Add item…"
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            className="flex-1 h-9 text-sm"
          />
          <Button type="submit" size="sm" className="h-9 px-3" disabled={!newItem.trim() || addItemMutation.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {/* ── Scrollable list body ── */}
      <div className="flex-1 overflow-y-auto pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-muted-foreground gap-4 px-4">
            <ShoppingCart className="h-10 w-10 opacity-20" />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Your list is empty</p>
              <p className="text-xs mt-1 text-muted-foreground max-w-xs">Tell Simmer what you need or plan your week and we'll build it for you.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => copilotInputRef.current?.focus()}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5 text-orange-500" />
                Ask Simmer
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href="#/planner">Plan your week</a>
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn("p-3", isMobile ? "flex flex-col gap-3" : "columns-2 gap-3 space-y-0")}>

            {/* Unchecked categories */}
            {Object.entries(grouped).map(([cat, catItems]) => (
              <div key={cat} className={cn("rounded-xl border border-border overflow-hidden break-inside-avoid", !isMobile && "mb-3")}>
                {/* Category header */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border">
                  <span className="text-muted-foreground">{CATEGORY_META[cat]?.icon}</span>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">
                    {CATEGORY_META[cat]?.label ?? cat}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{catItems.length}</span>
                </div>
                {/* Items */}
                {catItems.map((item, idx) => (
                  <div key={item.id}>
                    {idx > 0 && <Separator />}
                    <ItemRow
                      item={item}
                      onToggle={(id, checked) => toggleMutation.mutate({ id, checked })}
                      onDelete={id => deleteMutation.mutate(id)}
                      isMobile={isMobile}
                    />
                  </div>
                ))}
              </div>
            ))}

            {/* Checked + shop strip — full-width below the columns */}
            {(checkedItems.length > 0) && (
              <div className={cn("rounded-xl border border-border overflow-hidden break-inside-avoid", !isMobile && "mb-3")}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border">
                  <Check className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">In cart</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{checkedItems.length}</span>
                </div>
                {checkedItems.map((item, idx) => (
                  <div key={item.id}>
                    {idx > 0 && <Separator />}
                    <ItemRow
                      item={item}
                      onToggle={(id, checked) => toggleMutation.mutate({ id, checked })}
                      onDelete={id => deleteMutation.mutate(id)}
                      isMobile={isMobile}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Shop entire list */}
            <div className={cn("rounded-xl border border-border p-3 break-inside-avoid", !isMobile && "mb-3")}>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Shop online</p>
              <div className="flex gap-2">
                {STORES.map(store => (
                  <button
                    key={store.name}
                    onClick={() => window.open(store.buildUrl(unchecked[0]?.name ?? "groceries"), "_blank", "noopener")}
                    className={cn("flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold flex-1 justify-center", store.bg, store.text)}
                  >
                    <store.Logo />
                    <span className="hidden sm:inline">{store.shortName}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Opens store search · hover any item for direct links</p>
            </div>
          </div>
        )}
      </div>

      <AILimitModal open={aiLimitOpen} onOpenChange={setAiLimitOpen} />

      {/* ── Copilot quick-add bar — always visible ─────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border/50 bg-background/95 backdrop-blur-sm p-3 md:p-4 pb-6">
        <div className="max-w-2xl mx-auto">
        {!hasSentCopilot && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {[
              "What can I make with chicken tonight?",
              "Plan my week with quick meals",
              "Add pasta to my shopping list",
              "What am I missing for this week?",
            ].map((chip) => (
              <button
                key={chip}
                onClick={() => handleCopilotSubmit(chip)}
                className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
                style={{ background: "#2A1F18", border: "1px solid #3D2E24", color: "#C96A3A" }}
              >
                {chip}
              </button>
            ))}
          </div>
        )}
        {copilotError && (
          <p className="text-xs text-red-400 mb-1.5 px-1">{copilotError}</p>
        )}
        {copilotRemaining !== null && (
          <p className="text-[11px] text-muted-foreground mb-1.5 px-1 tabular-nums">
            {copilotRemaining} {copilotRemaining === 1 ? "message" : "messages"} left today
          </p>
        )}
        <div className="flex gap-2 items-center">
          <input
            ref={copilotInputRef}
            type="text"
            value={copilotInput}
            onChange={e => setCopilotInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCopilotSubmit()}
            placeholder="Ask Simmer to add items... (e.g. 'add ingredients for pasta carbonara')"
            disabled={copilotLoading}
            className="flex-1 h-9 rounded-lg border border-border bg-muted px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-orange-500/50 disabled:opacity-50"
          />
          <Button
            size="icon"
            onClick={() => handleCopilotSubmit()}
            disabled={copilotLoading || !copilotInput.trim()}
            className="h-9 w-9 shrink-0 bg-[#C96A3A] hover:bg-[#A85530] text-white"
          >
            {copilotLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Sparkles className="h-4 w-4" />}
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
