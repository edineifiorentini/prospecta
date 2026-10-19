import { describe, expect, it } from "vitest";
import { BlockedUrlError, assertSafeUrl, isPrivateIp, safeFetch } from "../../src/lib/safe-fetch.ts";

describe("proteção contra SSRF", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "224.0.0.1",
  ])("bloqueia IP interno/reservado %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "200.160.2.3", "2606:4700:4700::1111"])("permite IP público %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it.each([
    "http://localhost/",
    "http://localhost:4000/api/health",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://postgres:5432/",
    "http://wuzapi/",
    "http://servidor.local/",
    "file:///etc/passwd",
    "gopher://example.com/",
    "http://user:pass@example.com/",
    "http://example.com:22/",
  ])("recusa %s antes de qualquer conexão", (url) => {
    expect(() => assertSafeUrl(url)).toThrow(BlockedUrlError);
  });

  it("aceita URL pública comum", () => {
    expect(assertSafeUrl("https://www.example.com/contato").hostname).toBe("www.example.com");
  });

  it("bloqueia domínio público que resolve para IP interno (DNS rebinding)", async () => {
    // localtest.me é um domínio público cujo DNS aponta para 127.0.0.1
    await expect(safeFetch("http://localtest.me/")).rejects.toThrow();
  });
});
