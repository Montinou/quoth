/**
 * Authenticated App Layout
 * Wraps all protected routes with sidebar navigation
 * Features: Seamless transitions, breadcrumb navigation, responsive design
 */

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { cookies } from "next/headers";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read sidebar state from cookies for SSR
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <DashboardSidebar />
      <SidebarInset className="transition-all duration-300 ease-out md:pl-64">
        {/* Mobile header with sidebar trigger */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-sidebar-border/50 bg-sidebar/80 backdrop-blur-xl px-4 md:hidden">
          <SidebarTrigger className="-ml-1 transition-transform duration-200 hover:scale-110 active:scale-95" />
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-spectral to-violet-glow flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
              </svg>
            </div>
            <span
              className="font-medium text-lg tracking-tight"
              style={{ fontFamily: "var(--font-cormorant), serif" }}
            >
              Quoth
            </span>
          </div>
        </header>

        {/* Main content area with page transition */}
        <main className="flex-1 min-h-[calc(100vh-3.5rem)] md:min-h-screen bg-gradient-to-b from-obsidian via-obsidian to-charcoal relative">
          {/* Subtle grid background for depth */}
          <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />

          {/* Ambient glow orbs */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-spectral/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 right-0 w-80 h-80 bg-violet-glow/5 rounded-full blur-3xl pointer-events-none" />

          {/* Page content with entrance animation */}
          <div className="relative z-10 animate-page-enter">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
