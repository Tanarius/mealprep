import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Settings, Info, Loader2, X, Plus, ArrowRight,
  Home, Copy, Check, Link2, RefreshCw, LogOut,
  Shield, ChevronDown, Eye, EyeOff, Sparkles, CreditCard, Camera,
} from "lucide-react";
import { UpgradeModal } from "@/components/UpgradeModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { DicebearAvatar, AVATAR_STYLES } from "@/components/DicebearAvatar";

const CUISINES = [
  { key: "asian",          label: "Asian",           emoji: "🍜" },
  { key: "american",       label: "American",        emoji: "🍔" },
  { key: "italian",        label: "Italian",         emoji: "🍝" },
  { key: "tex-mex",        label: "Tex-Mex",         emoji: "🌮" },
  { key: "indian",         label: "Indian",          emoji: "🍛" },
  { key: "mediterranean",  label: "Mediterranean",   emoji: "🫒" },
  { key: "other",          label: "Other",           emoji: "🌍" },
];

// Derive app base URL for shareable invite links
function getInviteLink(code: string) {
  const base = window.location.origin;
  return `${base}/#/join/${code}`;
}

// Avatar with colored initials
function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const colors = [
    "from-orange-600 to-amber-700",
    "from-orange-500 to-amber-500",
    "from-green-500 to-emerald-600",
    "from-pink-500 to-rose-600",
    "from-cyan-500 to-blue-600",
  ];
  const color = colors[name.charCodeAt(0) % colors.length];
  const sz = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-14 h-14 text-xl" };
  return (
    <div className={cn("rounded-full bg-gradient-to-br flex items-center justify-center text-white font-bold shrink-0", color, sz[size])}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// Collapsible section wrapper
function Section({
  icon, title, subtitle, children, defaultOpen = true,
}: {
  icon: React.ReactNode; title: string; subtitle?: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-5 pb-5 border-t border-border/60">{children}</div>}
    </div>
  );
}

function EmailSection() {
  const { toast } = useToast();
  const { data: user } = useQuery<any>({ queryKey: ["/api/user"] });
  const [emailInput, setEmailInput] = useState("");
  const [editing, setEditing] = useState(false);

  const emailMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/auth/email", { email: emailInput.trim() }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setEditing(false);
      toast({ title: "Email saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save email", description: e.message, variant: "destructive" }),
  });

  const current = user?.email;

  return (
    <div className="mt-5 pt-4 border-t border-border/50 space-y-3">
      <div>
        <p className="text-xs font-medium mb-1">Email address</p>
        <p className="text-[11px] text-muted-foreground">Used for password reset. Optional.</p>
      </div>
      {!editing ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{current || <em>Not set</em>}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEmailInput(current || ""); setEditing(true); }}>
            {current ? "Change" : "Add email"}
          </Button>
        </div>
      ) : (
        <form className="flex gap-2 max-w-sm" onSubmit={e => { e.preventDefault(); emailMutation.mutate(); }}>
          <Input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} className="h-8 text-sm" required placeholder="you@example.com" autoFocus />
          <Button size="sm" className="h-8 px-3 text-xs shrink-0" type="submit" disabled={emailMutation.isPending}>
            {emailMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 shrink-0" type="button" onClick={() => setEditing(false)}>✕</Button>
        </form>
      )}
    </div>
  );
}

function DeleteAccountSection() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest("DELETE", "/api/auth/account", { password });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to delete account", variant: "destructive" });
        return;
      }
      queryClient.clear();
      window.location.hash = "#/";
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5 pt-4 border-t border-border/50">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-destructive/70 hover:text-destructive transition-colors"
        >
          Delete account
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium text-destructive">Delete account permanently</p>
          <p className="text-[11px] text-muted-foreground">This will delete all your data. If you're the only household member, all household data will also be deleted. This cannot be undone.</p>
          <form onSubmit={handleDelete} className="space-y-2 max-w-sm">
            <Input
              type="password"
              placeholder="Enter your password to confirm"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-8 text-sm"
              required
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="destructive" className="h-7 text-xs" disabled={!password || loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Delete forever
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setOpen(false); setPassword(""); }}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { toast } = useToast();

  // Ingredient state
  const [newIngredient, setNewIngredient] = useState("");
  const [newSubstitute, setNewSubstitute] = useState("");

  // Household editing state
  const [editingName, setEditingName] = useState(false);
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Password state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  // Avatar picker state
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [selectedAvatarStyle, setSelectedAvatarStyle] = useState<string | null>(null);

  // Billing state
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);

  // Detect ?upgraded=true after Stripe Checkout redirect
  useEffect(() => {
    if (window.location.hash.includes("upgraded=true")) {
      toast({ title: "Welcome to Premium!", description: "Your household now has the full Premium allowance." });
      // Clean the URL
      window.history.replaceState(null, "", window.location.pathname + "#/profile");
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    }
  }, []);

  // ── Queries ──────────────────────────────────────────
  const { data: user } = useQuery<any>({ queryKey: ["/api/user"], staleTime: 60_000 });
  const { data: allRecipes } = useQuery<any[]>({ queryKey: ["/api/recipes"], staleTime: 60_000 });
  const { data: userPrefs } = useQuery<any>({ queryKey: ["/api/taste-profile"], staleTime: 60_000 });

  const { data: profile, isLoading } = useQuery<any>({
    queryKey: ["/api/taste-profile"],
  });

  const { data: household, refetch: refetchHousehold } = useQuery<{
    id: number; name: string; inviteCode: string;
    members: { id: number; username: string }[];
  }>({ queryKey: ["/api/household"] });

  // ── Mutations ─────────────────────────────────────────
  const tasteMutation = useMutation({
    mutationFn: async (updates: any) => (await apiRequest("PATCH", "/api/taste-profile", updates)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/taste-profile"] }); toast({ title: "Saved" }); },
  });

  const renameHousehold = useMutation({
    mutationFn: (name: string) => apiRequest("PATCH", "/api/household/name", { name }).then(r => r.json()),
    onSuccess: () => { refetchHousehold(); queryClient.invalidateQueries({ queryKey: ["/api/household"] }); setEditingName(false); toast({ title: "Home renamed" }); },
    onError: () => toast({ title: "Could not rename", variant: "destructive" }),
  });

  const regenerateCode = useMutation({
    mutationFn: () => apiRequest("POST", "/api/household/regenerate").then(r => r.json()),
    onSuccess: () => { refetchHousehold(); queryClient.invalidateQueries({ queryKey: ["/api/household"] }); toast({ title: "New invite link generated" }); },
    onError: () => toast({ title: "Failed to regenerate", variant: "destructive" }),
  });

  const leaveHousehold = useMutation({
    mutationFn: () => apiRequest("POST", "/api/household/leave").then(r => r.json()),
    onSuccess: () => { refetchHousehold(); queryClient.invalidateQueries({ queryKey: ["/api/household"] }); setConfirmLeave(false); toast({ title: "You've left the home" }); },
    onError: () => toast({ title: "Failed to leave", variant: "destructive" }),
  });

  const avatarMutation = useMutation({
    mutationFn: (style: string) => apiRequest("PATCH", "/api/auth/avatar", { avatar: style }).then(r => r.json()),
    onSuccess: (_, style) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setAvatarPickerOpen(false);
      setSelectedAvatarStyle(null);
      toast({ title: "Avatar updated" });
    },
    onError: (e: any) => toast({ title: "Failed to save avatar", description: e.message, variant: "destructive" }),
  });

  const changePassword = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/auth/password", { currentPassword: currentPw, newPassword: newPw }).then(r => r.json()),
    onSuccess: () => { setCurrentPw(""); setNewPw(""); toast({ title: "Password updated" }); },
    onError: async (err: any) => {
      let msg = "Failed to update password";
      try { const json = JSON.parse(err.message); msg = json.error ?? msg; } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  async function handleManageBilling() {
    setBillingLoading(true);
    try {
      const res = await apiRequest("POST", "/api/billing/portal");
      const data = await res.json();
      if (data.error) {
        toast({ title: "Couldn't open billing portal", description: data.error, variant: "destructive" });
        return;
      }
      window.location.href = data.url;
    } catch (err: any) {
      toast({ title: "Couldn't open billing portal", description: err.message, variant: "destructive" });
    } finally {
      setBillingLoading(false);
    }
  }

  function copyInviteLink() {
    if (!household?.inviteCode) return;
    navigator.clipboard.writeText(getInviteLink(household.inviteCode));
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  function handleToggleCuisine(cuisine: string) {
    const liked = profile?.likedCuisines ?? [];
    tasteMutation.mutate({ likedCuisines: liked.includes(cuisine) ? liked.filter((c: string) => c !== cuisine) : [...liked, cuisine] });
  }

  const avoided: string[] = profile?.dislikedIngredients ?? [];
  const subs: Record<string, string | null> = (profile?.ingredientSubstitutions as any) ?? {};

  function addAvoidedIngredient() {
    const ing = newIngredient.trim().toLowerCase();
    if (!ing || avoided.includes(ing)) return;
    tasteMutation.mutate({ dislikedIngredients: [...avoided, ing], ingredientSubstitutions: { ...subs, [ing]: newSubstitute.trim() || null } });
    setNewIngredient(""); setNewSubstitute("");
  }

  function removeAvoidedIngredient(ing: string) {
    const newSubs = { ...subs }; delete newSubs[ing];
    tasteMutation.mutate({ dislikedIngredients: avoided.filter(a => a !== ing), ingredientSubstitutions: newSubs });
  }

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 border-b border-border">
        <h1 className="text-xl font-semibold">Profile & Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your home, preferences, and account.</p>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* ── User identity card ────────────────────── */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              {/* Avatar with change button */}
              <div className="relative shrink-0">
                <DicebearAvatar
                  username={user?.username ?? "?"}
                  avatarStyle={user?.avatar}
                  size={56}
                />
                <button
                  onClick={() => {
                    setSelectedAvatarStyle(user?.avatar ?? null);
                    setAvatarPickerOpen(o => !o);
                  }}
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                  title="Change avatar"
                >
                  <Camera className="h-3 w-3" />
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold truncate">{user?.username}</h2>
                {user?.email
                  ? <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.email}</p>
                  : <button className="text-xs text-amber-500 mt-0.5 hover:underline" onClick={() => document.getElementById('security-section')?.scrollIntoView({behavior:'smooth'})}>+ Add email for password reset</button>
                }
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={cn(
                    "inline-block text-xs px-2.5 py-0.5 rounded-full font-medium",
                    user?.subscriptionTier === "premium"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-muted text-muted-foreground border border-border"
                  )}>
                    {user?.subscriptionTier === "premium" ? "✦ Premium" : "Free plan"}
                  </span>
                  {user?.subscriptionTier === "premium" ? (
                    <button
                      onClick={handleManageBilling}
                      disabled={billingLoading}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {billingLoading
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <CreditCard className="h-3 w-3" />}
                      Manage billing
                    </button>
                  ) : (
                    <button
                      onClick={() => setUpgradeOpen(true)}
                      className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors"
                    >
                      <Sparkles className="h-3 w-3" />
                      Upgrade
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Avatar picker */}
            {avatarPickerOpen && (
              <div className="mt-4 pt-4 border-t border-border/60">
                <p className="text-xs font-medium mb-3 text-muted-foreground">Choose your avatar style — each one is unique to your username</p>
                <div className="grid grid-cols-4 gap-2">
                  {AVATAR_STYLES.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setSelectedAvatarStyle(key)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all",
                        selectedAvatarStyle === key
                          ? "border-primary bg-primary/10 ring-1 ring-primary/50"
                          : "border-border hover:border-muted-foreground/40 bg-muted/20"
                      )}
                    >
                      <DicebearAvatar username={user?.username ?? "user"} avatarStyle={key} size={48} />
                      <span className="text-[10px] text-muted-foreground leading-tight text-center">{label}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!selectedAvatarStyle || selectedAvatarStyle === user?.avatar || avatarMutation.isPending}
                    onClick={() => selectedAvatarStyle && avatarMutation.mutate(selectedAvatarStyle)}
                  >
                    {avatarMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save avatar
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAvatarPickerOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Stats row */}
            <div className="flex gap-3 mt-4 flex-wrap">
              {[
                { label: "Recipes", value: allRecipes?.length ?? 0 },
                { label: "Cuisines", value: new Set(allRecipes?.map((r:any) => r.cuisine)).size },
                { label: "Favorites", value: allRecipes?.filter((r:any) => r.isFavorite).length ?? 0 },
              ].map(s => (
                <div key={s.label} className="bg-muted/50 rounded-lg px-3 py-2 text-center min-w-[68px]">
                  <p className="text-base font-bold">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Your Home ────────────────────────────── */}
          <Section
            icon={<Home className="h-4 w-4 text-orange-400" />}
            title="Your Home"
            subtitle={household?.name ?? "Loading…"}
          >
            <div className="pt-4 space-y-5">

              {/* Name */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Home name</Label>
                {editingName ? (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={newHouseholdName}
                      onChange={e => setNewHouseholdName(e.target.value)}
                      className="h-8 text-sm"
                      maxLength={40}
                      onKeyDown={e => {
                        if (e.key === "Enter" && newHouseholdName.trim()) renameHousehold.mutate(newHouseholdName.trim());
                        if (e.key === "Escape") setEditingName(false);
                      }}
                    />
                    <Button size="sm" className="h-8 shrink-0" onClick={() => renameHousehold.mutate(newHouseholdName.trim())} disabled={!newHouseholdName.trim() || renameHousehold.isPending}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => setEditingName(false)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{household?.name ?? "—"}</span>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => { setNewHouseholdName(household?.name ?? ""); setEditingName(true); }}>
                      Rename
                    </Button>
                  </div>
                )}
              </div>

              {/* Members */}
              {household && household.members.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Members · {household.members.length}</Label>
                  <div className="flex flex-wrap gap-2">
                    {household.members.map(m => (
                      <div key={m.id} className="flex items-center gap-1.5 bg-muted rounded-full px-3 py-1">
                        <Avatar name={m.username} size="sm" />
                        <span className="text-xs font-medium">{m.username}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Invite link */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Invite link — share with housemates</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground overflow-hidden">
                    <Link2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">{household ? getInviteLink(household.inviteCode) : "—"}</span>
                  </div>
                  <Button size="sm" variant="outline" className="h-9 px-3 shrink-0" onClick={copyInviteLink} disabled={!household}>
                    {copiedLink ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-9 px-3 shrink-0"
                    onClick={() => regenerateCode.mutate()} disabled={regenerateCode.isPending}
                    title="Invalidate old link and generate a new one"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", regenerateCode.isPending && "animate-spin")} />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Rotating the link immediately invalidates the old one. Anyone with a saved copy won't be able to use it.
                </p>
              </div>

              {/* Leave */}
              <div className="pt-1 border-t border-border/50">
                {confirmLeave ? (
                  <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 space-y-2">
                    <p className="text-xs text-destructive font-medium">You'll leave <strong>{household?.name}</strong> and get your own solo home. This can't be undone.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => leaveHousehold.mutate()} disabled={leaveHousehold.isPending}>
                        {leaveHousehold.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Yes, leave
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmLeave(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1.5"
                    onClick={() => setConfirmLeave(true)}
                    disabled={(household?.members.length ?? 0) <= 1}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Leave this home
                  </Button>
                )}
              </div>
            </div>
          </Section>

          {/* ── Cuisine Preferences ──────────────────── */}
          <Section
            icon={<Sparkles className="h-4 w-4 text-orange-400" />}
            title="Cuisine Preferences"
            subtitle="Influences Simmer's recipe suggestions"
          >
            <div className="pt-4">
              <p className="text-xs text-muted-foreground mb-3">Toggle cuisines you enjoy — Simmer prioritises these when planning meals.</p>
              <div className="flex flex-wrap gap-2">
                {CUISINES.map(({ key, label, emoji }) => {
                  const isLiked = profile?.likedCuisines?.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => handleToggleCuisine(key)}
                      className={cn(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-sm font-medium transition-all",
                        isLiked
                          ? "bg-orange-600/20 border-orange-500/60 text-orange-200"
                          : "bg-muted border-border text-muted-foreground hover:border-muted-foreground/50"
                      )}
                    >
                      <span>{emoji}</span> {label}
                      {isLiked && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>

          {/* ── AI Constraints ───────────────────────── */}
          <Section
            icon={<Settings className="h-4 w-4 text-blue-400" />}
            title="Cooking Preferences"
            subtitle="Controls how recipes are generated"
            defaultOpen={false}
          >
            <div className="pt-4">
              <div className="flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
                <div>
                  <Label>Complexity target</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">What difficulty level should Simmer aim for?</p>
                </div>
                <Select
                  value={profile?.complexityPreference ?? "medium"}
                  onValueChange={val => tasteMutation.mutate({ complexityPreference: val })}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy (Beginner)</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard (Advanced)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Section>

          {/* ── Dietary Restrictions ─────────────────── */}
          <Section
            icon={<span className="text-sm">🚫</span>}
            title="Dietary Restrictions"
            subtitle={avoided.length > 0 ? `${avoided.length} ingredient${avoided.length !== 1 ? "s" : ""} avoided` : "None set"}
            defaultOpen={avoided.length > 0}
          >
            <div className="pt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Simmer automatically flags and substitutes these in suggestions.
              </p>

              {avoided.length > 0 && (
                <div className="space-y-2">
                  {avoided.map(ing => (
                    <div key={ing} className="flex items-center gap-2 group bg-muted/40 rounded-lg px-3 py-2">
                      <span className="text-sm font-medium min-w-[90px] capitalize">{ing}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Input
                        defaultValue={subs[ing] ?? ""}
                        placeholder="substitute (optional)"
                        className="h-7 text-xs flex-1 bg-transparent border-transparent focus:border-border"
                        onBlur={e => {
                          const newSubs = { ...subs, [ing]: e.target.value.trim() || null };
                          tasteMutation.mutate({ ingredientSubstitutions: newSubs });
                        }}
                      />
                      <button onClick={() => removeAvoidedIngredient(ing)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-center">
                <Input value={newIngredient} onChange={e => setNewIngredient(e.target.value)} placeholder="e.g. cilantro" className="h-8 text-sm flex-1" onKeyDown={e => e.key === "Enter" && newIngredient.trim() && addAvoidedIngredient()} />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Input value={newSubstitute} onChange={e => setNewSubstitute(e.target.value)} placeholder="substitute (optional)" className="h-8 text-sm flex-1" onKeyDown={e => e.key === "Enter" && newIngredient.trim() && addAvoidedIngredient()} />
                <Button size="sm" variant="outline" className="h-8 px-3 shrink-0" onClick={addAvoidedIngredient} disabled={!newIngredient.trim() || tasteMutation.isPending}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Section>

          {/* ── Account & Security ───────────────────── */}
          <div id="security-section">
          <Section
            icon={<Shield className="h-4 w-4 text-green-400" />}
            title="Account & Security"
            subtitle="Password, email & security"
            defaultOpen={false}
          >
            <div className="pt-4">
              <form
                className="space-y-3 max-w-sm"
                onSubmit={e => { e.preventDefault(); changePassword.mutate(); }}
              >
                <div className="space-y-1.5">
                  <Label className="text-xs">Current password</Label>
                  <div className="relative">
                    <Input type={showPw ? "text" : "password"} value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="pr-10 h-9" required />
                    <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">New password</Label>
                  <Input type={showPw ? "text" : "password"} value={newPw} onChange={e => setNewPw(e.target.value)} className="h-9" required minLength={6} />
                </div>
                <Button type="submit" size="sm" className="h-8" disabled={!currentPw || !newPw || changePassword.isPending}>
                  {changePassword.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Update password
                </Button>
              </form>

              <EmailSection />

              {/* Delete account */}
              <DeleteAccountSection />
            </div>
          </Section>
          </div>

          {/* How it works info */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex gap-3 items-start">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground/70 leading-relaxed">
              <strong>How Simmer uses your preferences:</strong> Every suggestion from the Kitchen Copilot and Weekly Planner respects your cuisine preferences, complexity target, and dietary restrictions — ingredients are flagged and silently substituted in suggestions.
            </p>
          </div>

        </div>
      </div>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </div>
  );
}
