import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;
beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
});
afterAll(closeAll);

describe("mapa da busca", () => {
  it("devolve a área usada e as empresas com coordenadas", async () => {
    const org = admin.organizationId;
    const mk = (name: string, lat: number | null, lon: number | null) =>
      prisma.company.create({ data: { organizationId: org, name, normName: name.toLowerCase(), latitude: lat, longitude: lon, city: "Umuarama" } });
    const perto = await mk("Escola Perto", -23.765, -53.32);
    const semPonto = await mk("Escola Sem Ponto", null, null);
    const job = await prisma.searchJob.create({
      data: {
        organizationId: org,
        provider: "OSM_OVERPASS",
        name: "escola · Umuarama, PR",
        status: "COMPLETED",
        params: { provider: "OSM_OVERPASS", keyword: "escola", city: "Umuarama", state: "PR", radiusKm: 5, limit: 20 },
        progress: { phase: "done", area: { lat: -23.7621, lon: -53.3116, label: "Umuarama, Paraná, Brasil", radiusKm: 5 } },
      },
    });
    await prisma.searchResult.createMany({
      data: [
        { searchJobId: job.id, position: 1, title: "Escola Perto", companyId: perto.id },
        { searchJobId: job.id, position: 2, title: "Escola Sem Ponto", companyId: semPonto.id },
        { searchJobId: job.id, position: 3, title: "Escola Perto", companyId: perto.id, isNew: false, matchedBy: "osm_id" },
      ],
    });

    const r = await call(admin, "GET", `/api/searches/${job.id}/map`);
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.area).toEqual({ lat: -23.7621, lon: -53.3116, label: "Umuarama, Paraná, Brasil", radiusKm: 5 });
    expect(d.points).toHaveLength(1);
    expect(d.points[0]).toMatchObject({ name: "Escola Perto", lat: -23.765, lon: -53.32, inCrm: false });
    expect(d.withoutLocation).toBe(1);
  });

  it("não expõe buscas de outra organização", async () => {
    const other = await prisma.organization.create({ data: { name: "Outra", slug: "outra-mapa" } });
    const job = await prisma.searchJob.create({ data: { organizationId: other.id, provider: "OSM_OVERPASS", name: "x", params: {} } });
    expect((await call(admin, "GET", `/api/searches/${job.id}/map`)).statusCode).toBe(404);
  });
});
