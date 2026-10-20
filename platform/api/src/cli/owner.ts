/**
 * Cria (ou recupera) um usuário Proprietário com senha temporária de troca obrigatória.
 *
 *   npm run cli:owner -- --email voce@exemplo.com --name "Seu Nome" [--out ../.local/acesso.txt]
 *   docker compose exec platform-api node dist/cli/owner.js --email ... --name ...
 *
 * A senha temporária é impressa no terminal, ou gravada apenas no arquivo indicado em --out.
 * Ela não é registrada em log nem na trilha de auditoria; no primeiro login o sistema exige a troca.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.ts";
import { hashPassword, passwordSchema } from "../modules/auth/password.ts";

// sem caracteres ambíguos (0/O, 1/l/I)
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function temporaryPassword(): string {
  for (;;) {
    const groups = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""));
    const pwd = groups.join("-");
    if (passwordSchema.safeParse(pwd).success && /\d/.test(pwd) && /[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) return pwd;
  }
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, org: { type: "string" }, out: { type: "string" } },
  });
  const email = z.string().trim().toLowerCase().email().parse(values.email);
  const org = values.org
    ? await prisma.organization.findUnique({ where: { slug: values.org } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("Nenhuma organização encontrada. Conclua a configuração inicial (/setup) antes.");

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const existing = await prisma.user.findUnique({ where: { email } });
  const name = z.string().trim().min(2).max(120).parse(values.name ?? existing?.name);

  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      create: { email, name, passwordHash, mustChangePassword: true },
      update: { name, passwordHash, mustChangePassword: true, isActive: true, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: now },
    });
    await tx.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      create: { userId: user.id, organizationId: org.id, role: "OWNER" },
      update: { role: "OWNER" },
    });
    // sessões antigas deixam de valer
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.auditLog.create({
      data: { action: existing ? "cli.owner_reset" : "cli.owner_created", organizationId: org.id, userId: user.id, entityType: "user", entityId: user.id, metadata: { via: "cli" } },
    });
    return user;
  });

  const text = [
    `Organização: ${org.name}`,
    `E-mail: ${user.email}`,
    `Papel: Proprietário (acesso total)`,
    `Senha temporária: ${password}`,
    `Gerada em: ${now.toISOString()}`,
    "",
    "A troca da senha é exigida no primeiro acesso. Apague este arquivo depois de entrar.",
    "",
  ].join("\n");

  if (values.out) {
    const path = resolve(values.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
    console.log(`${existing ? "Usuário atualizado" : "Usuário criado"}: ${user.email} (Proprietário). Senha temporária gravada em ${path}`);
  } else {
    console.log(text);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof z.ZodError ? "Parâmetros inválidos: informe --email e --name." : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
