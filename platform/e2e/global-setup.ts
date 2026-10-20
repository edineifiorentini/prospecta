import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { E2E_EMAIL, STATE, apiContainerRunning, root } from "./lib.ts";

/**
 * Cria (ou recupera) o usuário de teste com senha temporária pela CLI da plataforma.
 * Pilha em Docker: executa dentro do container da API; em desenvolvimento: npm run cli:owner.
 */
export default async function globalSetup() {
  const docker = apiContainerRunning();
  const args = ["--email", E2E_EMAIL, "--name", "Teste E2E"];
  const r = docker
    ? spawnSync("docker", ["compose", "exec", "-T", "platform-api", "node", "dist/cli/owner.js", ...args], { cwd: root, encoding: "utf8" })
    : // com shell, argumentos com espaço precisam de aspas
      spawnSync("npm", ["run", "--silent", "cli:owner", "--", ...args.map((a) => (a.includes(" ") ? `"${a}"` : a))], { cwd: resolve(root, "platform/api"), encoding: "utf8", shell: true });
  const tempPassword = r.stdout.match(/Senha temporária: (\S+)/)?.[1];
  if (r.status !== 0 || !tempPassword) throw new Error(`Não foi possível criar o usuário de teste: ${r.stderr || r.stdout}`);
  mkdirSync(dirname(STATE), { recursive: true });
  // a senha definitiva só existe durante a execução; o usuário é apagado no final
  writeFileSync(STATE, JSON.stringify({ email: E2E_EMAIL, tempPassword, password: `E2e-${randomBytes(9).toString("base64url")}`, mode: docker ? "docker" : "dev" }), { mode: 0o600 });
}
