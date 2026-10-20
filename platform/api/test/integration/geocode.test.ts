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

describe("geocodificação pelo Google (opcional)", () => {
  const googleHit = {
    status: "OK",
    results: [
      {
        types: ["locality", "political"],
        geometry: { location: { lat: -23.7334, lng: -52.8702 } },
        address_components: [
          { long_name: "Tapejara Google", short_name: "Tapejara Google", types: ["locality"] },
          { long_name: "Paraná", short_name: "PR", types: ["administrative_area_level_1"] },
          { long_name: "Brasil", short_name: "BR", types: ["country"] },
        ],
      },
    ],
  };

  function stubWithGoogle(google: () => Response) {
    const hosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        hosts.push(url.host);
        if (url.host === "maps.googleapis.com") return google();
        if (url.host.includes("nominatim")) return Response.json([{ lat: "-1", lon: "-2", display_name: "Reserva", name: "Reserva", osm_type: "node", type: "town" }]);
        return Response.json({ features: [] });
      }),
    );
    return hosts;
  }

  it("com chave de servidor, o Google vem primeiro", async () => {
    const { env } = await import("../../src/config/env.ts");
    env.GOOGLE_GEOCODING_API_KEY = "chave-de-teste";
    try {
      const hosts = stubWithGoogle(() => Response.json(googleHit));
      const p = await geocode({ city: "Tapejara Google", state: "PR" });
      expect(p).toMatchObject({ source: "Google", latitude: -23.7334, label: "Tapejara Google, Paraná, Brasil" });
      expect(hosts).toEqual(["maps.googleapis.com"]);
    } finally {
      env.GOOGLE_GEOCODING_API_KEY = "";
    }
  });

  it("cota esgotada ou chave recusada no Google: segue pelo Nominatim", async () => {
    const { env } = await import("../../src/config/env.ts");
    env.GOOGLE_GEOCODING_API_KEY = "chave-de-teste";
    try {
      const hosts = stubWithGoogle(() => Response.json({ status: "OVER_QUERY_LIMIT" }));
      const p = await geocode({ city: "Cidade Cota", state: "PR" });
      expect(p.source).toBe("Nominatim");
      expect(hosts).toEqual(["maps.googleapis.com", "nominatim.openstreetmap.org"]);
    } finally {
      env.GOOGLE_GEOCODING_API_KEY = "";
    }
  });
});
