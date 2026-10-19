import { describe, expect, it } from "vitest";
import { fold, normAddress, normDomain, normName, normalizeEmail, normalizePhone, safeHttpUrl } from "../../src/lib/normalize.ts";
import { confirmsDuplicate, nameSimilarity } from "../../src/modules/companies/dedupe.ts";
import { csvSafe, toCsv } from "../../src/lib/csv.ts";

describe("normalização", () => {
  it("remove acentos e pontuação", () => {
    expect(fold("Clínica São José & Cia.")).toBe("clinica sao jose e cia");
  });

  it("remove sufixos societários do nome", () => {
    expect(normName("Odonto Feliz LTDA - ME")).toBe("odonto feliz");
    expect(normName("ODONTO FELIZ")).toBe("odonto feliz");
  });

  it("normaliza telefones brasileiros para E.164", () => {
    expect(normalizePhone("(19) 3325-7728")?.e164).toBe("+551933257728");
    expect(normalizePhone("+55 19 99120-0967")?.e164).toBe("+5519991200967");
    expect(normalizePhone("19 99120 0967")?.isMobile).toBe(true);
    expect(normalizePhone("123")).toBeNull();
  });

  it("valida e-mails e descarta falsos positivos", () => {
    expect(normalizeEmail("Contato@Empresa.com.br")).toBe("contato@empresa.com.br");
    expect(normalizeEmail("mailto:x@y.com?subject=oi")).toBe("x@y.com");
    expect(normalizeEmail("logo@2x.png")).toBeNull();
    expect(normalizeEmail("nao-e-email")).toBeNull();
  });

  it("ignora domínios de redes sociais e agregadores", () => {
    expect(normDomain("https://www.empresa.com.br/contato")).toBe("empresa.com.br");
    expect(normDomain("https://instagram.com/empresa")).toBeNull();
    expect(normDomain("https://calendly.com/fulana")).toBeNull();
  });

  it("aceita apenas URLs http(s)", () => {
    expect(safeHttpUrl("empresa.com.br")).toBe("https://empresa.com.br/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("ftp://x.com")).toBeNull();
  });

  it("normaliza endereços", () => {
    expect(normAddress("R. das Flores, 100 - Centro")).toBe(normAddress("Rua das Flores 100 Centro"));
  });
});

describe("deduplicação", () => {
  it("calcula similaridade de nomes", () => {
    expect(nameSimilarity("Clínica Odonto Sorriso", "Odonto Sorriso")).toBeGreaterThan(0.5);
    expect(nameSimilarity("Padaria Pão Quente", "Academia Força")).toBe(0);
  });

  it("não funde franquias que compartilham domínio em cidades diferentes", () => {
    const cand = { id: "1", name: "Odontoclinic Unidade Centro", city: "Campinas", latitude: null, longitude: null, normAddress: null };
    expect(confirmsDuplicate("domain", { name: "Odontoclinic Unidade Sul", city: "Sorocaba" }, cand)).toBe(false);
    expect(confirmsDuplicate("domain", { name: "Odontoclinic Centro", city: "Campinas" }, cand)).toBe(true);
  });

  it("telefone igual só confirma com nome parecido ou proximidade", () => {
    const cand = { id: "1", name: "Pizzaria Bella", city: "Campinas", latitude: -22.9, longitude: -47.06, normAddress: null };
    expect(confirmsDuplicate("phone", { name: "Central de Delivery", city: "Campinas" }, cand)).toBe(false);
    expect(confirmsDuplicate("phone", { name: "Pizzaria Bella Napoli", city: "Campinas" }, cand)).toBe(true);
    expect(confirmsDuplicate("phone", { name: "Outro Nome", city: "Campinas", latitude: -22.9001, longitude: -47.0601 }, cand)).toBe(true);
  });
});

describe("exportação CSV", () => {
  it("neutraliza fórmulas (CSV injection)", () => {
    expect(csvSafe("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(csvSafe("+5519999")).toBe("'+5519999");
    expect(csvSafe("@cmd")).toBe("'@cmd");
    expect(csvSafe("Empresa normal")).toBe("Empresa normal");
  });

  it("gera CSV com BOM e cabeçalhos", () => {
    const out = toCsv([{ key: "a", label: "Nome" }], [{ a: "x,y" }]);
    expect(out.startsWith("﻿Nome")).toBe(true);
    expect(out).toContain('"x,y"');
  });
});
