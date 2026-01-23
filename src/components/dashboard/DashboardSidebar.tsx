"use client";

/**
 * Dashboard Sidebar Component
 * Elegant collapsible sidebar with smooth animations and intuitive navigation
 */

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Home,
  BookOpen,
  FileEdit,
  BarChart3,
  Key,
  Users,
  Settings,
  LogOut,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/quoth/Logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Main navigation items with enhanced metadata
const mainNavItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: Home,
    description: "Overview & stats",
  },
  {
    title: "Knowledge Base",
    href: "/knowledge-base",
    icon: BookOpen,
    description: "Search documentation",
  },
  {
    title: "Proposals",
    href: "/proposals",
    icon: FileEdit,
    description: "Review updates",
  },
  {
    title: "Analytics",
    href: "/dashboard/analytics",
    icon: BarChart3,
    description: "Usage & metrics",
  },
];

// Settings navigation items
const settingsNavItems = [
  {
    title: "API Keys",
    href: "/dashboard/api-keys",
    icon: Key,
    description: "MCP integration",
  },
  {
    title: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    description: "Account preferences",
  },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  // Check if a nav item is active
  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  // Get display name for user
  const displayName = profile?.username || user?.email?.split("@")[0] || "User";
  const userInitial = displayName[0]?.toUpperCase() || "U";

  return (
    <Sidebar collapsible="icon" className="border-r border-graphite/50 bg-sidebar">
      {/* Header with Logo */}
      <SidebarHeader className="border-b border-sidebar-border/50 pb-4">
        <div className="flex items-center justify-between">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                asChild
                className="transition-all duration-300 hover:bg-violet-spectral/10"
              >
                <Link href="/dashboard" className="group">
                  <div className="flex items-center gap-2">
                    <Logo size="sm" />
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger className="hidden md:flex transition-transform duration-200 hover:scale-110 hover:text-violet-spectral" />
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-gray-500 mb-2">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.href)}
                    tooltip={item.title}
                    className={`
                      group/item relative transition-all duration-300
                      hover:bg-violet-spectral/10
                      data-[active=true]:bg-violet-spectral/15
                      ${isActive(item.href) ? "nav-active-indicator" : ""}
                    `}
                  >
                    <Link href={item.href}>
                      <item.icon
                        className={`size-4 transition-all duration-300 group-hover/item:scale-110 ${
                          isActive(item.href)
                            ? "text-violet-spectral"
                            : "text-gray-400 group-hover/item:text-violet-ghost"
                        }`}
                      />
                      <span
                        className={`transition-colors duration-300 ${
                          isActive(item.href)
                            ? "text-white font-medium"
                            : "text-gray-400 group-hover/item:text-white"
                        }`}
                      >
                        {item.title}
                      </span>
                      {isActive(item.href) && (
                        <Sparkles className="size-3 text-violet-spectral ml-auto opacity-0 group-data-[state=expanded]:opacity-100 transition-opacity duration-300" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Team Navigation - Dynamic based on profile */}
        {profile?.default_project_id && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Team
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.includes("/team")}
                    tooltip="Team"
                    className={`
                      group/item relative transition-all duration-300
                      hover:bg-violet-spectral/10
                      data-[active=true]:bg-violet-spectral/15
                      ${pathname.includes("/team") ? "nav-active-indicator" : ""}
                    `}
                  >
                    <Link
                      href={`/dashboard/${profile.username}-knowledge-base/team`}
                    >
                      <Users
                        className={`size-4 transition-all duration-300 group-hover/item:scale-110 ${
                          pathname.includes("/team")
                            ? "text-violet-spectral"
                            : "text-gray-400 group-hover/item:text-violet-ghost"
                        }`}
                      />
                      <span
                        className={`transition-colors duration-300 ${
                          pathname.includes("/team")
                            ? "text-white font-medium"
                            : "text-gray-400 group-hover/item:text-white"
                        }`}
                      >
                        Team
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Settings Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-gray-500 mb-2">
            Settings
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.href)}
                    tooltip={item.title}
                    className={`
                      group/item relative transition-all duration-300
                      hover:bg-violet-spectral/10
                      data-[active=true]:bg-violet-spectral/15
                      ${isActive(item.href) ? "nav-active-indicator" : ""}
                    `}
                  >
                    <Link href={item.href}>
                      <item.icon
                        className={`size-4 transition-all duration-300 group-hover/item:scale-110 ${
                          isActive(item.href)
                            ? "text-violet-spectral"
                            : "text-gray-400 group-hover/item:text-violet-ghost"
                        }`}
                      />
                      <span
                        className={`transition-colors duration-300 ${
                          isActive(item.href)
                            ? "text-white font-medium"
                            : "text-gray-400 group-hover/item:text-white"
                        }`}
                      >
                        {item.title}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer with User Profile */}
      <SidebarFooter className="border-t border-sidebar-border/50 pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="group/user data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground transition-all duration-300 hover:bg-violet-spectral/10"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar with gradient ring */}
                    <div className="relative">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-spectral/30 to-violet-glow/30 flex items-center justify-center border border-violet-spectral/40 shrink-0 transition-all duration-300 group-hover/user:border-violet-spectral/60 group-hover/user:shadow-lg group-hover/user:shadow-violet-spectral/20">
                        <span className="text-violet-ghost font-semibold text-sm">
                          {userInitial}
                        </span>
                      </div>
                      {/* Online indicator */}
                      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-muted rounded-full border-2 border-sidebar" />
                    </div>
                    <div className="flex flex-col text-left text-sm leading-tight">
                      <span className="truncate font-semibold text-white">
                        {displayName}
                      </span>
                      <span className="truncate text-xs text-gray-500">
                        {user?.email}
                      </span>
                    </div>
                  </div>
                  <ChevronUp className="ml-auto size-4 text-gray-500 transition-transform duration-200 group-data-[state=open]/user:rotate-180" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl glass-panel border-violet-spectral/20 p-1"
                side="top"
                align="end"
                sideOffset={8}
              >
                {/* User info header */}
                <div className="px-3 py-2 mb-1">
                  <p className="text-sm font-medium text-white">{displayName}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-sidebar-border/50" />
                <DropdownMenuItem
                  asChild
                  className="cursor-pointer rounded-lg transition-colors duration-200 focus:bg-violet-spectral/15"
                >
                  <Link href="/dashboard/settings" className="flex items-center gap-2">
                    <Settings className="size-4 text-gray-400" />
                    <span>Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  asChild
                  className="cursor-pointer rounded-lg transition-colors duration-200 focus:bg-violet-spectral/15"
                >
                  <Link href="/dashboard/api-keys" className="flex items-center gap-2">
                    <Key className="size-4 text-gray-400" />
                    <span>API Keys</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-sidebar-border/50" />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer rounded-lg text-red-400 focus:text-red-400 focus:bg-red-500/10 transition-colors duration-200"
                >
                  <LogOut className="mr-2 size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail className="hover:bg-violet-spectral/10 transition-colors duration-300" />
    </Sidebar>
  );
}
