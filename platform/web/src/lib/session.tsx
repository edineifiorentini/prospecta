"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setCsrfToken } from "./api";

export type Role = "OWNER" | "ADMIN" | "MANAGER" | "SALES" | "VIEWER";

export type SessionData =
  | { authenticated: false }
  | {
      authenticated: true;
      csrfToken: string;
      /** isPlatformAdmin: cria contas (empresas separadas) para clientes */
      user: { id: string; name: string; email: string; isPlatformAdmin?: boolean };
      mustChangePassword: boolean;
      organization: { id: string; name: string; slug: string } | null;
      role: Role;
      permissions: string[];
    };

type Ctx = {
  session: Extract<SessionData, { authenticated: true }> | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export const sessionQueryKey = ["auth", "session"] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => api<SessionData>("/auth/session"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setCsrfToken(data?.authenticated ? data.csrfToken : null);
  }, [data]);

  const session = data?.authenticated ? data : null;
  const value: Ctx = {
    session,
    loading: isLoading,
    can: (p) => !!session?.permissions.includes(p),
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: sessionQueryKey });
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fora do SessionProvider");
  return ctx;
}
