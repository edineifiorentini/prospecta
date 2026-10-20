import {
  BarChart3,
  Building2,
  CheckSquare,
  FileSearch,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Rocket,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission?: string };

export const NAV_MAIN: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/buscar", label: "Encontrar Empresas", icon: Search },
  { href: "/empresas", label: "Empresas", icon: Building2 },
  { href: "/listas", label: "Minhas Listas", icon: ListChecks },
  { href: "/crm", label: "CRM", icon: KanbanSquare },
  { href: "/auditorias", label: "Auditorias", icon: FileSearch },
  { href: "/conversas", label: "Conversas", icon: MessageCircle },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

export const NAV_FOOTER: NavItem[] = [
  { href: "/primeiros-passos", label: "Primeiros passos", icon: Rocket },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];
