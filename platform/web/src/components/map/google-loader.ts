"use client";

import { useSyncExternalStore } from "react";

/**
 * Carrega a Maps JavaScript API uma vez por sessão e acompanha o estado. Se o Google recusar a chave
 * (inválida, site não autorizado, cobrança desativada, cota esgotada) ou não carregar, o estado vira
 * "failed" e todos os mapas voltam para o OpenStreetMap até a página ser recarregada.
 */
export type GoogleStatus = { state: "idle" | "loading" | "ready" | "failed"; reason?: string };

let status: GoogleStatus = { state: "idle" };
let loading: Promise<void> | null = null;
const subscribers = new Set<() => void>();
const IDLE: GoogleStatus = { state: "idle" };

function setStatus(next: GoogleStatus) {
  status = next;
  subscribers.forEach((fn) => fn());
}

let failing = false;

export function markGoogleFailed(reason: string) {
  if (failing || status.state === "failed") return;
  failing = true;
  console.warn(`Mapa do Google indisponível: ${reason}. Usando o mapa do OpenStreetMap.`);
  // o Google ainda desenha a tela de erro logo após avisar a falha: troca de mapa só depois disso
  window.setTimeout(() => setStatus({ state: "failed", reason }), 300);
}

type GoogleWindow = Window & { gm_authFailure?: () => void; __prospectaGoogleMapsReady?: () => void };

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (status.state === "failed") return Promise.reject(new Error(status.reason));
  if (loading) return loading;
  setStatus({ state: "loading" });
  loading = new Promise<void>((resolve, reject) => {
    const w = window as GoogleWindow;
    const fail = (reason: string) => {
      markGoogleFailed(reason);
      reject(new Error(reason));
    };
    // chamado pelo Google quando a chave é recusada (inclusive depois de o mapa já ter aparecido)
    w.gm_authFailure = () => fail("o Google recusou a chave (verifique restrição de site, APIs ativadas e faturamento)");
    w.__prospectaGoogleMapsReady = () => {
      if (status.state !== "failed") setStatus({ state: "ready" });
      resolve();
    };
    const params = new URLSearchParams({ key: apiKey, v: "weekly", loading: "async", libraries: "marker", language: "pt-BR", region: "BR", callback: "__prospectaGoogleMapsReady" });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => fail("não foi possível baixar o Google Maps (sem conexão ou bloqueado)");
    document.head.append(script);
    window.setTimeout(() => status.state === "loading" && fail("o Google Maps demorou demais para responder"), 15_000);
  });
  return loading;
}

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

export const useGoogleStatus = () => useSyncExternalStore(subscribe, () => status, () => IDLE);
