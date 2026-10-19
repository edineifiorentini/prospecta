#!/usr/bin/env node
// Cria/atualiza o .env da raiz a partir do .env.example, gerando segredos fortes
// para cada valor <gerado>/<gerado32>. Valores já existentes no .env nunca são alterados.
// Uso:  node platform/scripts/init-env.mjs
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const examplePath = join(root, ".env.example");
const envPath = join(root, ".env");

const urlSafe = (bytes) => randomBytes(bytes).toString("base64url");
const generators = {
  "<gerado>": (key) => {
    if (key === "APP_ENCRYPTION_KEY") return randomBytes(32).toString("base64");
    if (key === "MAILPIT_UI_AUTH") return `admin:${urlSafe(18)}`;
    return urlSafe(32);
  },
  "<gerado32>": () => randomBytes(16).toString("hex"), // 32 caracteres hexadecimais
};

const parse = (text) => {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
};

const example = readFileSync(examplePath, "utf8");
const current = existsSync(envPath) ? parse(readFileSync(envPath, "utf8")) : new Map();
const seen = new Set();
let generated = 0;

const out = example.split(/\r?\n/).map((line) => {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) return line;
  const [, key, value] = m;
  seen.add(key);
  if (current.has(key) && !(current.get(key) in generators)) return `${key}=${current.get(key)}`;
  const gen = generators[value];
  if (gen) { generated++; return `${key}=${gen(key)}`; }
  return line;
});

// preserva variáveis extras que o usuário tenha adicionado ao .env
for (const [key, value] of current) if (!seen.has(key)) out.push(`${key}=${value}`);

writeFileSync(envPath, out.join("\n"), { encoding: "utf8", mode: 0o600 });
console.log(`.env pronto em ${envPath} (${generated} segredo(s) gerado(s); valores existentes preservados).`);
