import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// Parâmetros mínimos recomendados pela OWASP para Argon2id (19 MiB, 2 iterações, 1 via).
const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTIONS);

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

// Hash descartável usado quando o e-mail não existe, para que o tempo de resposta não revele contas.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(plain: string) {
  dummyHash ??= hashPassword("prospecta-dummy-password-for-timing");
  await verifyPassword(await dummyHash, plain);
}

const COMMON = new Set([
  "1234567890", "12345678910", "senha12345", "senha123456", "password123", "qwertyuiop", "admin12345",
  "prospecta123", "abcdefghij", "1q2w3e4r5t", "0123456789", "mudar12345", "trocar12345",
]);

export const passwordSchema = z
  .string()
  .min(10, "A senha precisa ter pelo menos 10 caracteres.")
  .max(128, "A senha pode ter no máximo 128 caracteres.")
  .refine((v) => !COMMON.has(v.toLowerCase()), "Essa senha é muito comum. Escolha outra.")
  .refine((v) => new Set(v).size >= 5, "Use uma senha com mais variedade de caracteres.");
