"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Brand } from "@/components/brand";
import { NAV_FOOTER, NAV_MAIN, type NavItem } from "./nav";

function Items({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <SidebarMenu className="gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.label} className="h-9 rounded-lg data-active:bg-card data-active:shadow-[0_1px_2px_rgb(0_0_0/0.06)] data-active:[&_svg]:text-primary">
              <Link href={item.href} aria-current={active ? "page" : undefined}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" variant="sidebar" className="border-r-0" data-tour="nav">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <Link href="/dashboard" className="flex items-center rounded-lg outline-none group-data-[collapsible=icon]:justify-center" aria-label="Prospecta — início">
          <span className="group-data-[collapsible=icon]:hidden">
            <Brand />
          </span>
          <span className="hidden group-data-[collapsible=icon]:inline-flex">
            <Brand compact />
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-1.5">
        <SidebarGroup>
          <SidebarGroupContent>
            <Items items={NAV_MAIN} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 pb-4">
        <Items items={NAV_FOOTER} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
