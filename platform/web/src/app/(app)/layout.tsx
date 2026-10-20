"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { GlobalSearch } from "@/components/shell/global-search";
import { UserMenu } from "@/components/shell/user-menu";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { useSession } from "@/lib/session";

export default function AppLayout({ children }: LayoutProps<"/">) {
  const { session, loading } = useSession();
  const router = useRouter();

  const blocked = !!session?.mustChangePassword;
  useEffect(() => {
    if (!loading && !session) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    else if (blocked) router.replace("/trocar-senha");
  }, [loading, session, blocked, router]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-background">
        <header className="glass sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-4">
          <SidebarTrigger className="-ml-1" aria-label="Recolher ou expandir menu" />
          <Separator orientation="vertical" className="h-5" />
          <div className="flex min-w-0 flex-1 justify-center md:justify-start">
            <GlobalSearch />
          </div>
          <UserMenu />
        </header>
        <OfflineBanner />
        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">{session && !blocked ? children : <ShellSkeleton />}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
