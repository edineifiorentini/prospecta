import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { geocode, tryGeocode } from "../../src/modules/geo/geocode.ts";
import { closeAll, resetDb } from "./helpers.ts";

const photonHit = (name: string) => ({
  features: [{ geometry: { coordinates: [-53.31, -23.76] }, properties: { name, state: "Paraná", country: "Brasil", countrycode: "BR", type: "city" } }],
});

/** Simula os serviços externos: cada função recebe a URL e devolve a resposta. */
function stubServices(handlers: { nominatim: () => Response; photon: () => Response }) {
  const hosts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      hosts.push(url.host);
      return url.host.includes("nominatim") ? handlers.nominatim() : handlers.photon();
    }),
  );
  return hosts;
}

beforeAll(resetDb);
afterEach(() => vi.unstubAllGlobals());
afterAll(closeAll);

describe("geocodificação com reserva", () => {
  it("usa o Photon quando o Nominatim está fora do ar e guarda no cache", async () => {
    const hosts = stubServices({ nominatim: () => new Response("No healthy backends", { status: 503 }), photon: () => Response.json(photonHit("Cidade Reserva")) });
    const p = await geocode({ city: "Cidade Reserva", state: "PR", country: "Brasil" });
    expect(p).toMatchObject({ source: "Photon", latitude: -23.76, longitude: -53.31 });
    expect(hosts).toEqual(["nominatim.openstreetmap.org", "photon.komoot.io"]);
    expect((await geocode({ city: "Cidade Reserva", state: "PR", country: "Brasil" })).source).toBe("cache");
  });

  it("tenta o Photon também quando o Nominatim não encontra", async () => {
    stubServices({ nominatim: () => Response.json([]), photon: () => Response.json(photonHit("Vila Só No Photon")) });
    expect((await geocode({ city: "Vila Só No Photon", state: "PR" })).source).toBe("Photon");
  });

  it("com os dois serviços fora do ar, a busca recebe o motivo e segue sem coordenadas", async () => {
    stubServices({ nominatim: () => new Response("", { status: 503 }), photon: () => new Response("", { status: 502 }) });
    const r = await tryGeocode({ city: "Umuarama Sem Mapa", state: "PR" });
    expect(r.place).toBeNull();
    expect(r.problem).toMatchObject({ kind: "unavailable" });
    expect(r.problem?.message).toContain("HTTP 503");
  });

  it("local inexistente é informado como não encontrado", async () => {
    stubServices({ nominatim: () => Response.json([]), photon: () => Response.json({ features: [] }) });
    const r = await tryGeocode({ city: "Cidade Que Não Existe", state: "PR" });
    expect(r.problem?.kind).toBe("not_found");
  });
});
