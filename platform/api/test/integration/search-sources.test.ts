import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;
beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
});
afterAll(closeAll);

describe("fontes de busca (padrão: Google Maps; Econodata só com dados empresariais ligados)", () => {
  it("lista o Google Maps, a Econodata (indisponível até ligar os dados empresariais) e a importação de CSV", async () => {
    const list = (await call(admin, "GET", "/api/sources")).json() as { id: string; available: boolean; reason: string | null }[];
    expect(list.map((s) => s.id)).toEqual(["GOOGLE_MAPS_SCRAPER", "ECONODATA", "CSV_IMPORT"]);
    expect(list.find((s) => s.id === "ECONODATA")).toMatchObject({ available: false, reason: expect.stringContaining("Dados empresariais") });
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
