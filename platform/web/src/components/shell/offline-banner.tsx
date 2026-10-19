"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { api } from "@/lib/api";

/** Avisa quando o navegador está offline ou a API não responde. */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const { isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ ok: boolean }>("/health"),
    refetchInterval: 30_000,
    retry: 1,
  });

  if (online && !isError) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm text-foreground">
      <WifiOff className="size-4 text-warning" />
      {online ? "Não foi possível falar com a API. Verifique se os containers estão em execução." : "Você está offline. As alterações serão possíveis quando a conexão voltar."}
    </div>
  );
}
