/**
 * Adaptador de mensagens independente do provedor.
 * Implementações: WuzAPI (whatsmeow, não oficial, local) e WhatsApp Business Cloud API (oficial, Meta).
 * O restante do sistema (CRM, políticas de consentimento, filas) só conhece esta interface.
 */

export type AccountStatus = "DISCONNECTED" | "CONNECTING" | "QR_PENDING" | "CONNECTED" | "LOGGED_OUT" | "ERROR";

export type ProviderAccount = {
  id: string;
  externalUserId: string | null;
  token: string | null;
  hmacKey: string | null;
  settings: Record<string, unknown>;
};

export type ProvisionResult = { externalUserId: string; token: string; hmacKey: string };

export type InboundEvent =
  | { kind: "message"; externalId: string; chatId: string; phone: string; fromMe: boolean; isGroup: boolean; text: string; pushName: string | null; timestamp: Date; type: string }
  | { kind: "receipt"; externalIds: string[]; state: "DELIVERED" | "READ"; timestamp: Date }
  | { kind: "status"; status: AccountStatus; jid?: string | null; detail?: string }
  | { kind: "qr"; qr: string }
  | { kind: "ignored"; type: string };

export interface MessagingProvider {
  readonly kind: "WUZAPI" | "WHATSAPP_CLOUD";
  provision(name: string, webhookUrl: string): Promise<ProvisionResult>;
  deprovision(account: ProviderAccount): Promise<void>;
  connect(account: ProviderAccount): Promise<void>;
  status(account: ProviderAccount): Promise<{ status: AccountStatus; jid: string | null }>;
  qr(account: ProviderAccount): Promise<string | null>;
  disconnect(account: ProviderAccount): Promise<void>;
  logout(account: ProviderAccount): Promise<void>;
  /** Envia texto. `clientId` é usado como ID da mensagem para tornar o envio idempotente no provedor. */
  sendText(account: ProviderAccount, phoneE164: string, body: string, clientId: string): Promise<{ externalId: string; sentAt: Date }>;
  /** Verifica a assinatura do webhook sobre o corpo bruto. */
  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, account: ProviderAccount): boolean;
  /** Converte o payload do provedor em eventos normalizados. */
  parseWebhook(payload: unknown): InboundEvent[];
  /** Identifica a conta (externalUserId) a partir do payload. */
  accountKeyFromPayload(payload: unknown): string | null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}
