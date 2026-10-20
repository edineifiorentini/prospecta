"use client";

import { useEffect, useState } from "react";

/**
 * Estado local inicializado a partir de um valor externo (ex.: dados do servidor) e
 * reiniciado quando esse valor muda — ajuste durante o render, sem efeito em cascata.
 */
export function useSyncedState<S, T>(source: S, init: (source: S) => T) {
  const [state, setState] = useState(() => init(source));
  const [prev, setPrev] = useState(source);
  if (prev !== source) {
    setPrev(source);
    setState(init(source));
  }
  return [state, setState] as const;
}

/** Horário atual, atualizado periodicamente (para destacar prazos vencidos sem chamar Date.now() no render). */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
