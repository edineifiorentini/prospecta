import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;
beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
});
afterAll(closeAll);

describe("fontes de busca (padrão: só Google Maps)", () => {
  it("lista só o Google Maps e a importação de CSV", async () => {
    const ids = (await call(admin, "GET", "/api/sources")).json().map((s: { id: string }) => s.id);
    expect(ids).toEqual(["GOOGLE_MAPS_SCRAPER", "CSV_IMPORT"]);
  });

  it("recusa novas buscas no OpenStreetMap", async () => {
    const r = await call(admin, "POST", "/api/searches", { provider: "OSM_OVERPASS", keyword: "contabilidade", city: "Tapejara", state: "PR" });
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toContain("desativada");
  });

  it("Repetir uma busca antiga do OpenStreetMap roda pelo Google Maps", async () => {
    const old = await prisma.searchJob.create({
      data: {
        organizationId: admin.organizationId,
        provider: "OSM_OVERPASS",
        name: "Contabilidade · Tapejara, PR",
        status: "FAILED",
        params: { provider: "OSM_OVERPASS", keyword: "Contabilidade", city: "Tapejara", state: "PR", radiusKm: 5, limit: 20 },
      },
    });
    const r = await call(admin, "POST", `/api/searches/${old.id}/retry`);
    expect(r.statusCode).toBe(201);
    const copy = await prisma.searchJob.findUniqueOrThrow({ where: { id: r.json().id } });
    expect(copy.provider).toBe("GOOGLE_MAPS_SCRAPER");
    expect(copy.params).toMatchObject({ provider: "GOOGLE_MAPS_SCRAPER", keyword: "Contabilidade", city: "Tapejara" });
  });
});
