import { describe, expect, it } from "vitest";
import { graphError, instagramHandle, parseBio } from "../../src/modules/social/instagram.ts";

describe("Instagram (API oficial): @, bio e erros da Graph API", () => {
  it("aceita @, nome ou link do perfil e recusa o que não é Instagram", () => {
    expect(instagramHandle("@Padaria.Exemplo")).toBe("padaria.exemplo");
    expect(instagramHandle("https://www.instagram.com/padariaexemplo/")).toBe("padariaexemplo");
    expect(instagramHandle("padaria_exemplo")).toBe("padaria_exemplo");
    expect(instagramHandle("padaria exemplo")).toBeNull();
    expect(instagramHandle("https://www.facebook.com/padariaexemplo")).toBeNull();
    expect(instagramHandle("")).toBeNull();
  });

  it("bio: WhatsApp só com link wa.me ou celular junto de whats/zap; fixo continua telefone", () => {
    const f = parseBio("Atendimento 8h às 18h\n📲 WhatsApp (44) 9 9123-4567\nFixo: (44) 3622-1234\n✉️ Contato@PadariaExemplo.com.br\nPedidos: wa.me/5544988776655\nwww.padariaexemplo.com.br");
    expect(f.whatsapp).toEqual(expect.arrayContaining(["+5544991234567", "+5544988776655"]));
    expect(f.phones).toEqual(["+554436221234"]);
    expect(f.emails).toEqual(["contato@padariaexemplo.com.br"]);
    expect(f.links[0]).toContain("padariaexemplo.com.br");
  });

  it("celular sem menção a WhatsApp fica como telefone (sem supor WhatsApp)", () => {
    expect(parseBio("Ligue (44) 9 9123-4567")).toMatchObject({ whatsapp: [], phones: ["+5544991234567"] });
    expect(parseBio(null)).toEqual({ whatsapp: [], phones: [], emails: [], links: [] });
  });

  it("erros da Graph API viram mensagens claras", () => {
    const body = (code: number, sub?: number, message = "x") => JSON.stringify({ error: { message, code, ...(sub ? { error_subcode: sub } : {}) } });
    expect(graphError(400, body(190))?.code).toBe("AUTH");
    expect(graphError(400, body(4))?.code).toBe("RATE_LIMIT");
    expect(graphError(400, body(17))?.code).toBe("RATE_LIMIT");
    expect(graphError(400, body(110, 2207013))?.code).toBe("NOT_FOUND");
    expect(graphError(400, body(100, undefined, "The user with username: x cannot be found"))?.code).toBe("NOT_FOUND");
    expect(graphError(400, body(100))?.code).toBe("INVALID_REQUEST");
    expect(graphError(500, "<html>erro</html>")).toBeNull();
  });
});
