import { promises as dns } from "node:dns";
import tls from "node:tls";
import { env } from "../../config/env.ts";
import { assertSafeUrl, isPrivateIp } from "../../lib/safe-fetch.ts";

/**
 * Certificado HTTPS do site: validade, emissor e dias até vencer. Só leitura do handshake TLS (nada intrusivo),
 * conectando ao IP público já conferido (evita SSRF e troca de DNS no meio do caminho).
 */
export type TlsInfo = { checked: boolean; valid: boolean | null; error: string | null; issuer: string | null; validTo: string | null; daysLeft: number | null; protocol: string | null };

export async function checkTls(url: string, timeoutMs = 10_000): Promise<TlsInfo> {
  const none = (error: string): TlsInfo => ({ checked: false, valid: null, error, issuer: null, validTo: null, daysLeft: null, protocol: null });
  let host: string;
  let address: string;
  try {
    host = assertSafeUrl(url).hostname;
    const allowed = env.CRAWLER_ALLOW_HOSTS.split(",").map((s) => s.trim()).includes(host);
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || (!allowed && addrs.some((a) => isPrivateIp(a.address)))) return none("Destino interno bloqueado.");
    address = addrs[0]!.address;
  } catch (err) {
    return none((err as Error).message.slice(0, 120));
  }
  return new Promise<TlsInfo>((resolve) => {
    const socket = tls.connect({ host: address, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
    const done = (info: TlsInfo) => {
      socket.destroy();
      resolve(info);
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      const issuer = cert?.issuer ? ((cert.issuer as Record<string, string>).O ?? (cert.issuer as Record<string, string>).CN ?? null) : null;
      done({
        checked: true,
        valid: socket.authorized,
        error: socket.authorized ? null : String(socket.authorizationError ?? "certificado não confiável"),
        issuer,
        validTo: validTo ? validTo.toISOString() : null,
        daysLeft: validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : null,
        protocol: socket.getProtocol(),
      });
    });
    socket.once("timeout", () => done(none("Tempo esgotado na conexão HTTPS.")));
    socket.once("error", (err) => done(none(err.message.slice(0, 120))));
  });
}
