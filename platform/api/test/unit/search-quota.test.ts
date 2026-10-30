import { describe, expect, it } from "vitest";
import { applyCap, capOf, startOfDayBR } from "../../src/modules/search/quota.ts";

describe("limites de pesquisa: regras puras", () => {
  it("o dia vira à 0h de Brasília, não à 0h UTC", () => {
    // 30/10 às 23h30 em Brasília ainda é dia 30 (já é 31 em UTC)
    expect(startOfDayBR(new Date("2026-10-31T02:30:00Z")).toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(startOfDayBR(new Date("2026-10-31T03:00:00Z")).toISOString()).toBe("2026-10-31T03:00:00.000Z");
  });

  it("aplica o teto só quando ele é menor que o pedido, com o mínimo do motor", () => {
    expect(applyCap({ limit: 60 }, null)).toEqual({ limit: 60 });
    expect(applyCap({ limit: 60 }, 80)).toEqual({ limit: 60 });
    expect(applyCap({ limit: 60 }, 20)).toEqual({ limit: 20, quotaCap: 20 });
    expect(applyCap({ limit: 60 }, 3)).toEqual({ limit: 5, quotaCap: 3 });
  });

  it("a reserva de uma pesquisa em andamento é o teto dela", () => {
    expect(capOf({ limit: 5, quotaCap: 3 })).toBe(3);
    expect(capOf({ limit: 60 })).toBe(60);
    expect(capOf(null)).toBe(0);
  });
});
