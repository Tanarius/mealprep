import { ChefHat, Calendar, ShoppingCart, Package, Sparkles, LogOut, Cookie, Home } from "lucide-react";
import { ActivityFeed } from "@/components/ActivityFeed";
import { DicebearAvatar } from "@/components/DicebearAvatar";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Home", url: "/", icon: Home },
  { title: "Recipes", url: "/recipes", icon: ChefHat },
  { title: "Weekly Plan", url: "/planner", icon: Calendar },
  { title: "Shopping List", url: "/shopping", icon: ShoppingCart },
  { title: "Snacks & Products", url: "/snacks", icon: Cookie },
  { title: "Pantry", url: "/pantry", icon: Package },
];

export function AppSidebar() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/logout").then(() => {}),
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/auth";
    },
  });

  const { data: user } = useQuery<any>({
    queryKey: ["/api/user"],
    staleTime: 60_000,
  });

  const { data: household } = useQuery<{ name: string; inviteCode: string; members: { id: number; username: string }[] }>({
    queryKey: ["/api/household"],
    staleTime: 60_000,
    enabled: !!user,
  });

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#C96A3A] text-white font-bold text-base shrink-0 select-none">
            S
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-bold text-[#F5EDE3]">Simmer</span>
            <span className="text-xs text-muted-foreground">
              {household?.name
                ? `${household.name} · ${household.members.length} ${household.members.length === 1 ? "member" : "members"}`
                : "Your household"}
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.url === "/"
                    ? location === "/" || location === ""
                    : location.startsWith(item.url);

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      data-testid={`nav-${item.title.toLowerCase().replace(" ", "-")}`}
                    >
                      <Link href={item.url} onClick={() => isMobile && setOpenMobile(false)}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupContent>
            <ActivityFeed />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/profile"}
                  className="bg-orange-600/10 text-orange-500 hover:bg-orange-600/20 hover:text-orange-600 transition-colors"
                >
                  <Link href="/profile">
                    <Sparkles className="h-4 w-4" />
                    <span className="font-medium">Profile & Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border space-y-2">
        {user && (
          <>
            {/* User row */}
            <Link
              href="/profile"
              className="flex items-center gap-2.5 rounded-lg hover:bg-muted/50 transition-colors -mx-1 px-1 py-1 no-underline"
              onClick={() => isMobile && setOpenMobile(false)}
            >
              <DicebearAvatar
                username={user.username ?? "?"}
                avatarStyle={user.avatar}
                size={28}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-foreground">{user.username}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{user.subscriptionTier === "premium" ? "✦ Premium" : user.subscriptionTier === "test" ? "Test plan" : "Free plan"}</p>
              </div>
            </Link>

            {/* Usage row */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {/* Test accounts run on a daily window; free/premium on a monthly one */}
              <span className="inline-flex items-center gap-1 bg-muted rounded-full px-2 py-0.5 font-mono tabular-nums">
                Suggestions {user.subscriptionTier === 'test'
                  ? `${user.aiCallsToday ?? 0}/200`
                  : `${user.aiCallsMonth ?? 0}/${user.subscriptionTier === 'premium' ? 500 : 30}`}
              </span>
              <span className="inline-flex items-center gap-1 bg-muted rounded-full px-2 py-0.5 font-mono tabular-nums">
                Messages {user.subscriptionTier === 'test'
                  ? `${user.copilotCallsToday ?? 0}/200`
                  : `${user.copilotCallsMonth ?? 0}/${user.subscriptionTier === 'premium' ? 1000 : 100}`}
              </span>
            </div>
          </>
        )}
        <button
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          data-testid="button-logout"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
