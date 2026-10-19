"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api, setCsrfToken } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/labels";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

export function UserMenu() {
  const { session } = useSession();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  if (!session) return null;

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setCsrfToken(null);
    qc.clear();
    router.replace("/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 rounded-full px-1.5 pr-3" aria-label="Menu do usuário">
          <Avatar className="size-7">
            <AvatarFallback className="bg-accent text-[11px] font-semibold text-accent-foreground">{initials(session.user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{session.user.name.split(" ")[0]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{session.user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{session.user.email}</div>
          <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            {ROLE_LABEL[session.role]} · {session.organization?.name}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Aparência</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Escuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> Sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/configuracoes">
            <Settings /> Configurações
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={logout} className="text-destructive focus:text-destructive">
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
