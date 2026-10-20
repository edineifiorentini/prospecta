import { env } from "../../config/env.ts";
import { hmacSha256Hex, randomToken, safeEqual } from "../../lib/crypto.ts";
import type { AccountStatus, InboundEvent, MessagingProvider, ProviderAccount, ProvisionResult } from "./provider.ts";
import { ProviderError } from "./provider.ts";

/**
 * WuzAPI 1.0.9 (MIT) — https://github.com/asternic/wuzapi
 * - Admin: header `Authorization: <WUZAPI_ADMIN_TOKEN>` em /admin/users
 * - Usuário: header `token: <token do usuário>`
 * - Webhook JSON (WEBHOOK_FORMAT=json) assinado com HMAC-SHA256 no header `x-hmac-signature`
 * Serviço acessível somente pela rede interna do Docker.
 */
const EVENTS = ["Message", "ReadReceipt", "Connected", "Disconnected", "LoggedOut", "PairSuccess", "PairError", "QR", "QRTimeout", "ConnectFailure", "TemporaryBan", "StreamReplaced"];

async function call<T>(path: string, init: { method?: string; token?: string; admin?: boolean; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.admin) headers.Authorization = env.WUZAPI_ADMIN_TOKEN;
  if (init.token) headers.token = init.token;
  let res: Response;
  try {
    res = await fetch(`${env.WUZAPI_URL.replace(/\/$/, "")}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ProviderError("Serviço WuzAPI indisponível. Verifique o container prospecta-wuzapi.", 503);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const msg = (json as { error?: string; data?: { Details?: string } } | null)?.error ?? (json as { data?: { Details?: string } } | null)?.data?.Details ?? text.slice(0, 200);
    throw new ProviderError(`WuzAPI ${res.status}: ${msg}`, res.status);
  }
  return json as T;
}

const need = (a: ProviderAccount) => {
  if (!a.token) throw new ProviderError("Conta sem token configurado.");
  return a.token;
};

const digits = (s: string) => s.replace(/\D/g, "");

export const wuzapiProvider: MessagingProvider = {
  kind: "WUZAPI",

  async provision(name: string, webhookUrl: string): Promise<ProvisionResult> {
    const token = randomToken(24);
    const hmacKey = randomToken(36); // ≥ 32 caracteres exigidos pelo WuzAPI
    const created = await call<{ data?: { id?: string | number }; id?: string | number }>("/admin/users", {
      method: "POST",
      admin: true,
      body: { name: name.slice(0, 60), token, webhook: webhookUrl, events: EVENTS.join(","), hmacKey, history: 0 },
    });
    const id = created?.data?.id ?? created?.id;
    if (id === undefined) throw new ProviderError("WuzAPI não retornou o ID do usuário criado.");
    // reforça o webhook/eventos pelo endpoint do usuário (formato confirmado na versão 1.0.9)
    await call("/webhook", { method: "POST", token, body: { webhookurl: webhookUrl, events: EVENTS } }).catch(() => undefined);
    // WuzAPI 1.0.9 só passa a assinar com a chave da instância após /session/hmac/config (ou reinício)
    await call("/session/hmac/config", { method: "POST", token, body: { hmac_key: hmacKey } });
    return { externalUserId: String(id), token, hmacKey };
  },

  async deprovision(a) {
    if (a.externalUserId) await call(`/admin/users/${encodeURIComponent(a.externalUserId)}`, { method: "DELETE", admin: true }).catch(() => undefined);
  },

  async ensureSignature(a) {
    if (!a.hmacKey) return;
    await call("/session/hmac/config", { method: "POST", token: need(a), body: { hmac_key: a.hmacKey } });
  },

  async connect(a) {
    await this.ensureSignature?.(a);
    try {
      await call("/session/connect", { method: "POST", token: need(a), body: { Subscribe: EVENTS, Immediate: true } });
    } catch (err) {
      // já conectado ao servidor do WhatsApp: não é erro (o QR/estado segue disponível)
      if (!(err instanceof ProviderError && err.status === 409)) throw err;
    }
  },

  async status(a) {
    const r = await call<{ data?: { Connected?: boolean; LoggedIn?: boolean; jid?: string; Jid?: string } }>("/session/status", { token: need(a) });
    const d = r?.data ?? {};
    const status: AccountStatus = d.LoggedIn ? "CONNECTED" : d.Connected ? "QR_PENDING" : "DISCONNECTED";
    return { status, jid: d.jid ?? d.Jid ?? null };
  },

  async qr(a) {
    try {
      const r = await call<{ data?: { QRCode?: string } }>("/session/qr", { token: need(a) });
      const qr = r?.data?.QRCode ?? null;
      return qr && qr.startsWith("data:image/") ? qr : null;
    } catch (err) {
      // "no session": o QR expirou ou a sessão ainda não foi iniciada (é preciso Reconectar)
      if (err instanceof ProviderError && ((err.status && err.status < 500) || /no session/i.test(err.message))) return null;
      throw err;
    }
  },

  async disconnect(a) {
    await call("/session/disconnect", { method: "POST", token: need(a) });
  },

  async logout(a) {
    await call("/session/logout", { method: "POST", token: need(a) });
  },

  async sendText(a, phoneE164, body, clientId) {
    const r = await call<{ data?: { Id?: string; Timestamp?: string } }>("/chat/send/text", {
      method: "POST",
      token: need(a),
      body: { Phone: digits(phoneE164), Body: body, Id: clientId.replace(/-/g, "").toUpperCase().slice(0, 32) },
    });
    return { externalId: r?.data?.Id ?? clientId, sentAt: r?.data?.Timestamp ? new Date(r.data.Timestamp) : new Date() };
  },

  verifySignature(rawBody, headers, a) {
    const sig = headers["x-hmac-signature"];
    const value = Array.isArray(sig) ? sig[0] : sig;
    if (!value || !a.hmacKey) return false;
    return safeEqual(value.toLowerCase(), hmacSha256Hex(a.hmacKey, rawBody));
  },

  accountKeyFromPayload(payload) {
    const p = payload as { userID?: string | number } | null;
    return p?.userID !== undefined && p?.userID !== null ? String(p.userID) : null;
  },

  parseWebhook(payload): InboundEvent[] {
    const p = (payload ?? {}) as { type?: string; event?: Record<string, unknown>; state?: string; qrCodeBase64?: string };
    const type = p.type ?? "unknown";
    const evt = (p.event ?? {}) as Record<string, unknown>;
    switch (type) {
      case "Message": {
        const info = (evt.Info ?? {}) as Record<string, unknown>;
        const msg = (evt.Message ?? {}) as Record<string, unknown>;
        const ext = (msg.extendedTextMessage ?? {}) as Record<string, unknown>;
        const text =
          (typeof msg.conversation === "string" && msg.conversation) ||
          (typeof ext.text === "string" && ext.text) ||
          (typeof (msg.imageMessage as Record<string, unknown> | undefined)?.caption === "string" && `[imagem] ${(msg.imageMessage as Record<string, string>).caption}`) ||
          (msg.imageMessage ? "[imagem]" : msg.audioMessage ? "[áudio]" : msg.documentMessage ? "[documento]" : msg.videoMessage ? "[vídeo]" : msg.stickerMessage ? "[figurinha]" : msg.locationMessage ? "[localização]" : "");
        const chat = String(info.Chat ?? "");
        const isGroup = chat.endsWith("@g.us") || info.IsGroup === true;
        const user = chat.split("@")[0]?.split(":")[0] ?? "";
        if (!info.ID || !chat) return [{ kind: "ignored", type }];
        return [
          {
            kind: "message",
            externalId: String(info.ID),
            chatId: chat,
            phone: `+${digits(user)}`,
            fromMe: info.IsFromMe === true,
            isGroup,
            text: String(text).slice(0, 4096),
            pushName: typeof info.PushName === "string" ? info.PushName.slice(0, 80) : null,
            timestamp: info.Timestamp ? new Date(String(info.Timestamp)) : new Date(),
            type: String(info.Type ?? "text"),
          },
        ];
      }
      case "ReadReceipt": {
        const ids = (evt.MessageIDs as string[] | undefined) ?? [];
        const state = p.state === "Delivered" ? "DELIVERED" : p.state === "Read" ? "READ" : null;
        if (!ids.length || !state) return [{ kind: "ignored", type }];
        return [{ kind: "receipt", externalIds: ids.map(String), state, timestamp: evt.Timestamp ? new Date(String(evt.Timestamp)) : new Date() }];
      }
      case "QR":
        return p.qrCodeBase64 ? [{ kind: "qr", qr: p.qrCodeBase64 }, { kind: "status", status: "QR_PENDING" }] : [{ kind: "status", status: "QR_PENDING" }];
      case "Connected":
      case "PairSuccess":
        return [{ kind: "status", status: "CONNECTED", jid: (evt.ID as string | undefined) ?? null }];
      case "LoggedOut":
        return [{ kind: "status", status: "LOGGED_OUT", detail: "Sessão encerrada no celular." }];
      case "Disconnected":
      case "StreamReplaced":
        return [{ kind: "status", status: "DISCONNECTED", detail: type }];
      case "ConnectFailure":
      case "TemporaryBan":
      case "PairError":
        return [{ kind: "status", status: "ERROR", detail: type === "TemporaryBan" ? "Número temporariamente banido pelo WhatsApp." : type }];
      case "QRTimeout":
        return [{ kind: "status", status: "DISCONNECTED", detail: "QR Code expirou sem leitura." }];
      default:
        return [{ kind: "ignored", type }];
    }
  },
};
