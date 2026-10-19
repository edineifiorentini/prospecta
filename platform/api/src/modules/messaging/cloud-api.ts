import { createHmac } from "node:crypto";
import { safeEqual } from "../../lib/crypto.ts";
import type { InboundEvent, MessagingProvider, ProviderAccount } from "./provider.ts";
import { ProviderError } from "./provider.ts";

/**
 * Adaptador preparado para a WhatsApp Business Cloud API (oficial, Meta — Graph API).
 * Configuração por conta (messaging_accounts.settings):
 *   { phoneNumberId, wabaId, apiVersion } + token (access token, cifrado) + hmacKey (App Secret, cifrado)
 * Webhook: assinatura `X-Hub-Signature-256: sha256=<hmac>` com o App Secret.
 * Mensagens iniciadas pela empresa fora da janela de 24 h exigem template aprovado pela Meta.
 * Pareamento por QR Code não existe nesta API (conexão é feita no Meta Business Manager).
 */
const graph = (a: ProviderAccount) => `https://graph.facebook.com/${String(a.settings.apiVersion ?? "v21.0")}`;

export const cloudApiProvider: MessagingProvider = {
  kind: "WHATSAPP_CLOUD",
  async provision() {
    throw new ProviderError("Contas da API oficial são criadas no Meta Business Manager; cadastre o phoneNumberId e o token nas configurações.");
  },
  async deprovision() {},
  async connect() {},
  async status(a) {
    if (!a.token || !a.settings.phoneNumberId) return { status: "DISCONNECTED", jid: null };
    const res = await fetch(`${graph(a)}/${String(a.settings.phoneNumberId)}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${a.token}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { status: "ERROR", jid: null };
    const j = (await res.json()) as { display_phone_number?: string };
    return { status: "CONNECTED", jid: j.display_phone_number ?? null };
  },
  async qr() {
    return null;
  },
  async disconnect() {},
  async logout() {},
  async sendText(a, phoneE164, body) {
    if (!a.token || !a.settings.phoneNumberId) throw new ProviderError("API oficial não configurada.");
    const res = await fetch(`${graph(a)}/${String(a.settings.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: phoneE164.replace(/\D/g, ""), type: "text", text: { preview_url: false, body } }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !j.messages?.[0]) throw new ProviderError(`Cloud API: ${j.error?.message ?? res.status}`, res.status);
    return { externalId: j.messages[0].id, sentAt: new Date() };
  },
  verifySignature(rawBody, headers, a) {
    const sig = headers["x-hub-signature-256"];
    const value = Array.isArray(sig) ? sig[0] : sig;
    if (!value?.startsWith("sha256=") || !a.hmacKey) return false;
    return safeEqual(value.slice(7), createHmac("sha256", a.hmacKey).update(rawBody).digest("hex"));
  },
  accountKeyFromPayload(payload) {
    const p = payload as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[] };
    return p?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
  },
  parseWebhook(payload): InboundEvent[] {
    const out: InboundEvent[] = [];
    const p = payload as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
    for (const entry of p?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        for (const m of (v.messages as Record<string, unknown>[] | undefined) ?? []) {
          const from = String(m.from ?? "");
          out.push({
            kind: "message",
            externalId: String(m.id),
            chatId: from,
            phone: `+${from}`,
            fromMe: false,
            isGroup: false,
            text: String(((m.text as Record<string, unknown> | undefined)?.body as string | undefined) ?? `[${String(m.type)}]`).slice(0, 4096),
            pushName: null,
            timestamp: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()),
            type: String(m.type ?? "text"),
          });
        }
        for (const s of (v.statuses as Record<string, unknown>[] | undefined) ?? []) {
          const st = String(s.status);
          if (st === "delivered" || st === "read") out.push({ kind: "receipt", externalIds: [String(s.id)], state: st === "read" ? "READ" : "DELIVERED", timestamp: new Date(Number(s.timestamp ?? 0) * 1000 || Date.now()) });
        }
      }
    }
    return out.length ? out : [{ kind: "ignored", type: "cloud" }];
  },
};
