import { describe, expect, it } from "vitest";
import { extractPage, isValidCnpj, pickPriorityLinks } from "../../src/modules/enrichment/extract.ts";
import { parseSocialUrl } from "../../src/modules/enrichment/social.ts";
import { aggregate } from "../../src/modules/enrichment/service.ts";

const HTML = `<!doctype html><html lang="pt-BR"><head>
<title>Clínica Exemplo</title><meta name="description" content="Odontologia em Campinas">
<meta name="viewport" content="width=device-width"><meta property="og:title" content="Clínica Exemplo">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Clínica Exemplo","telephone":"+55 19 3333-4444","email":"oi@clinica.example","sameAs":["https://www.instagram.com/clinicaexemplo/"]}</script>
</head><body>
<nav><a href="/contato">Fale conosco</a><a href="/sobre-nos">Quem somos</a><a href="/blog/post">Blog</a><a href="https://outro.com/x">Parceiro</a></nav>
<h1>Bem-vindo</h1><h2>Serviços</h2>
<p>Ligue (19) 3333-4444 ou 19 98888-7777. Escreva para contato@clinica.example. CNPJ 99.887.766/0001-05.</p>
<a href="mailto:agenda@clinica.example">agenda</a> <a href="tel:+5519333344445">tel inválido longo</a>
<a href="https://wa.me/5519988887777">WhatsApp</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Compartilhar</a>
<a href="https://facebook.com/clinica.exemplo">Facebook</a>
<a href="https://www.linkedin.com/company/clinica-exemplo/about/">LinkedIn</a>
<img src="a.png"><img src="b.png" alt="logo">
<form><input type="email" name="email"><textarea></textarea><button>Enviar</button></form>
<script>var x = "nao@deve.aparecer";</script>
</body></html>`;

describe("extração de páginas", () => {
  const ex = extractPage(HTML, "https://www.clinica.example/");

  it("lê metadados de SEO", () => {
    expect(ex.title).toBe("Clínica Exemplo");
    expect(ex.metaDescription).toBe("Odontologia em Campinas");
    expect(ex.viewport).toBe(true);
    expect(ex.h1).toEqual(["Bem-vindo"]);
    expect(ex.h2Count).toBe(1);
    expect(ex.og["og:title"]).toBe("Clínica Exemplo");
    expect(ex.images).toBe(2);
    expect(ex.imagesWithoutAlt).toBe(1);
    expect(ex.hasContactForm).toBe(true);
  });

  it("encontra e-mails (mailto, texto, JSON-LD) e ignora scripts", () => {
    const values = ex.emails.map((e) => e.value).sort();
    expect(values).toEqual(["agenda@clinica.example", "contato@clinica.example", "oi@clinica.example"]);
  });

  it("encontra telefones válidos em E.164", () => {
    const values = ex.phones.map((p) => p.e164).sort();
    expect(values).toContain("+551933334444");
    expect(values).toContain("+5519988887777");
  });

  it("identifica WhatsApp e redes sociais sem links de compartilhamento", () => {
    expect(ex.whatsapp.map((w) => w.e164)).toEqual(["+5519988887777"]);
    const nets = ex.socials.map((s) => `${s.network}:${s.handle}`).sort();
    expect(nets).toEqual(["FACEBOOK:clinica.exemplo", "INSTAGRAM:clinicaexemplo", "LINKEDIN:company/clinica-exemplo"]);
  });

  it("valida CNPJ pelos dígitos verificadores", () => {
    expect(ex.cnpjs).toEqual(["99887766000105"]);
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
    expect(isValidCnpj("99887766000105")).toBe(true);
  });

  it("prioriza páginas de contato e institucionais", () => {
    const links = pickPriorityLinks(ex.internalLinks, 5);
    expect(links[0]).toBe("https://www.clinica.example/contato");
    expect(links).toContain("https://www.clinica.example/sobre-nos");
    expect(links).not.toContain("https://www.clinica.example/blog/post");
  });

  it("consolida achados de várias páginas", () => {
    const page = { ...ex, status: 200, finalUrl: ex.url, elapsedMs: 10, rendered: "http" as const };
    const agg = aggregate({ pages: [page, { ...page, finalUrl: "https://www.clinica.example/contato" }] } as never);
    expect(agg.emails.get("contato@clinica.example")?.pages.length).toBe(2);
    expect(agg.cnpjs).toEqual(["99887766000105"]);
  });
});

describe("redes sociais", () => {
  it.each([
    ["https://instagram.com/empresa/?hl=pt", "INSTAGRAM", "empresa"],
    ["https://m.facebook.com/pages/Empresa/123456", "FACEBOOK", "123456"],
    ["https://www.youtube.com/@canal", "YOUTUBE", "@canal"],
    ["https://www.tiktok.com/@perfil", "TIKTOK", "@perfil"],
    ["https://twitter.com/empresa", "X", "empresa"],
    ["https://api.whatsapp.com/send?phone=5519999990000", "WHATSAPP", "5519999990000"],
  ])("interpreta %s", (url, network, handle) => {
    const r = parseSocialUrl(url);
    expect(r?.network).toBe(network);
    expect(r?.handle).toBe(handle);
  });

  it.each(["https://www.instagram.com/p/abc123/", "https://www.facebook.com/sharer.php?u=x", "https://twitter.com/intent/tweet", "https://www.linkedin.com/feed/"])(
    "ignora %s",
    (url) => {
      expect(parseSocialUrl(url)).toBeNull();
    },
  );

  it("aceita identificador puro com dica de rede (etiquetas do OSM)", () => {
    expect(parseSocialUrl("@minhaempresa", "INSTAGRAM")?.url).toBe("https://www.instagram.com/minhaempresa/");
  });
});
