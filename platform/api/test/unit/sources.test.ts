import { describe, expect, it } from "vitest";
import { accentInsensitive, buildOverpassAreaQuery, buildOverpassQuery, mapOsmElement, ufCode } from "../../src/modules/sources/overpass.ts";
import { photonToPlace } from "../../src/modules/geo/geocode.ts";
import { planOsmQuery } from "../../src/modules/sources/osm-categories.ts";
import { depthForLimit, mapGmapsRow } from "../../src/modules/sources/gmaps.ts";
import { matchesFilters, searchFiltersSchema } from "../../src/modules/sources/types.ts";
import { detectMapping, mapCsvRow, parseCsv } from "../../src/modules/imports/csv-import.ts";

describe("OpenStreetMap", () => {
  it("mapeia nichos em português para etiquetas OSM", () => {
    expect(planOsmQuery("dentista").tags[0]).toEqual({ key: "amenity", value: "dentist" });
    expect(planOsmQuery("Clínica de Estética").label).toBe("Estética");
    expect(planOsmQuery("loja de pranchas de surf").tags).toEqual([]);
  });

  it("monta consulta somente leitura com raio e limite", () => {
    const { query } = buildOverpassQuery("academia", -22.9, -47.06, 3000, 50);
    expect(query).toContain('nwr["leisure"="fitness_centre"](around:3000,-22.900000,-47.060000);');
    expect(query).toContain("out center tags qt 100;");
  });

  it("sem serviço de mapas, delimita pelo limite do município (UF e acentos tolerados)", () => {
    expect(ufCode("Paraná")).toBe("PR");
    expect(ufCode("pr")).toBe("PR");
    expect(ufCode("Sao Paulo")).toBe("SP");
    expect(ufCode("Ontario")).toBeNull();
    const re = new RegExp(`^${accentInsensitive("Sao Joao")}$`, "i");
    expect(re.test("São João")).toBe(true);
    expect(re.test("Sao Joao")).toBe(true);

    const { query } = buildOverpassAreaQuery("escola", { city: "Umuarama", state: "PR", country: "Brasil" }, 5000, 60);
    expect(query).toContain('area["ISO3166-2"="BR-PR"]["admin_level"="4"]->.uf;');
    expect(query).toContain('["admin_level"="8"]');
    expect(query).toContain("map_to_area->.scope;");
    expect(query).toContain('nwr["amenity"="school"](area.scope);');
    expect(query).not.toContain("around:");

    const bairro = buildOverpassAreaQuery("dentista", { city: "Campinas", state: "SP", neighborhood: "Cambuí" }, 3000, 20).query;
    expect(bairro).toContain('["place"~"^(suburb|neighbourhood|quarter)$"]');
    expect(bairro).toContain("(around.center:3000)");
  });

  it("converte resultado do Photon (geocodificador reserva)", () => {
    const p = photonToPlace({
      geometry: { coordinates: [-53.3116, -23.7621] },
      properties: { name: "Umuarama", state: "Paraná", country: "Brasil", countrycode: "BR", type: "city", extent: [-53.66, -23.44, -53.17, -23.96] },
    });
    expect(p).toMatchObject({ latitude: -23.7621, longitude: -53.3116, label: "Umuarama, Paraná, Brasil", source: "Photon" });
    expect(p.bbox).toEqual([-23.96, -23.44, -53.66, -53.17]);
  });

  it("escapa termos livres na busca por nome", () => {
    const { query } = buildOverpassQuery('surf "shop"', 0, 0, 1000, 10);
    expect(query).toContain('surf \\"shop\\"');
  });

  it("converte elemento OSM sem inventar campos", () => {
    const c = mapOsmElement({ type: "node", id: 42, lat: -22.9, lon: -47.06, tags: { name: "Dente Feliz", amenity: "dentist", phone: "+55 19 3333-4444", "contact:instagram": "dentefeliz" } });
    expect(c?.name).toBe("Dente Feliz");
    expect(c?.category).toBe("Dentista");
    expect(c?.website).toBeNull();
    expect(c?.city).toBeNull();
    expect(c?.osmId).toBe("node/42");
    expect(c?.socials).toEqual([{ network: "INSTAGRAM", url: "dentefeliz" }]);
  });
});

describe("Google Maps Scraper (CSV do motor gosom)", () => {
  it("calcula profundidade pela quantidade desejada", () => {
    expect(depthForLimit(10)).toBe(1);
    expect(depthForLimit(60)).toBe(5);
    expect(depthForLimit(500)).toBe(20);
  });

  it("mapeia uma linha do CSV", () => {
    const c = mapGmapsRow({
      title: "Clínica X",
      category: "Dentista",
      phone: "+55 19 3333-4444",
      website: "https://clinicax.com.br/",
      review_rating: "4.8",
      review_count: "120",
      place_id: "ChIJ123",
      cid: "999",
      complete_address: JSON.stringify({ borough: "Cambuí", city: "Campinas", state: "SP", postal_code: "13025-000", country: "BR" }),
      emails: "",
      images: JSON.stringify([{ image: "a" }, { image: "b" }]),
      open_hours: JSON.stringify({ Monday: ["8–18"] }),
      user_reviews: "[]",
    });
    expect(c?.rating).toBe(4.8);
    expect(c?.reviewCount).toBe(120);
    expect(c?.city).toBe("Campinas");
    expect(c?.neighborhood).toBe("Cambuí");
    expect(c?.emails).toEqual([]);
    expect(c?.publicProfile?.photoCount).toBe(2);
    expect(c?.raw).not.toHaveProperty("user_reviews");
  });
});

describe("filtros combináveis", () => {
  const base = { website: "https://x.com", phones: ["+55"], emails: [], rating: 4.5, reviewCount: 30 };
  it("aplica presença e faixas", () => {
    expect(matchesFilters(base, searchFiltersSchema.parse({ website: "with", email: "without" }))).toBe(true);
    expect(matchesFilters(base, searchFiltersSchema.parse({ email: "with" }))).toBe(false);
    expect(matchesFilters(base, searchFiltersSchema.parse({ minRating: 4.6 }))).toBe(false);
    expect(matchesFilters({ ...base, rating: null }, searchFiltersSchema.parse({ minRating: 1 }))).toBe(false);
  });
});

describe("importação CSV", () => {
  it("detecta delimitador e mapeamento em português", () => {
    const csv = "Nome Fantasia;Telefone;E-mail;Site;Cidade;UF\nPadaria Boa;(19) 3333-4444;contato@padaria.com;padaria.com;Campinas;SP\n";
    const { rows, headers } = parseCsv(csv);
    const { format, mapping } = detectMapping(headers);
    expect(format).toBe("generic");
    expect(mapping.name).toBe("Nome Fantasia");
    expect(mapping.phone).toBe("Telefone");
    expect(mapping.email).toBe("E-mail");
    expect(mapping.state).toBe("UF");
    const c = mapCsvRow(rows[0]!, mapping, format);
    expect(c?.website).toBe("https://padaria.com/");
    expect(c?.phones).toEqual(["(19) 3333-4444"]);
  });

  it("reconhece o CSV completo do Google Maps Scraper", () => {
    expect(detectMapping(["input_id", "link", "title", "category", "place_id", "review_rating"]).format).toBe("gosom");
  });
});
