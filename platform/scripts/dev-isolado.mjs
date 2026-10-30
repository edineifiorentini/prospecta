#!/usr/bin/env node
// Sobe API (porta 4100) ou site (porta 3100) no host usando SOMENTE o ambiente isolado
// (platform/.local/teste-isolado.env). Antes de iniciar a API, confere que o banco tem a marca
// "prospecta:descartavel"; sem ela, não inicia.
// Uso: node platform/scripts/dev-isolado.mjs api|web
//      node platform/scripts/dev-isolado.mjs api --chaves   (pede chaves de IA sem mostrar na tela;
//      elas ficam só na memória do processo, nunca em arquivo)
//      node platform/scripts/dev-isolado.mjs api --chave=xai   (Windows: abre uma janela com campo
//      mascarado para a chave de um provedor: openai, anthropic, xai, gemini ou groq)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const platform = join(here, "..");
const envFile = join(platform, ".local", "teste-isolado.env");
if (!existsSync(envFile)) {
  console.error("Ambiente isolado ausente. Rode antes: node platform/scripts/teste-isolado.mjs up");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const AI_KEYS = [
  ["OPENAI_API_KEY", "OpenAI", "sk-", "openai"],
  ["ANTHROPIC_API_KEY", "Anthropic (Claude)", "sk-ant-", "anthropic"],
  ["XAI_API_KEY", "xAI (Grok)", "xai-", "xai"],
  ["GEMINI_API_KEY", "Google (Gemini)", "AIza", "gemini"],
  ["GROQ_API_KEY", "Groq", "gsk_", "groq"],
];
// chaves de IA só entram quando digitadas aqui: nunca herdadas do sistema por acaso
for (const [name] of AI_KEYS) env[name] = "";
// só este computador: nada do ambiente de teste fica visível na rede local
env.HOST = "127.0.0.1";

/** Lê uma linha sem eco no terminal (a chave não aparece na tela nem no histórico). */
function askHidden(question) {
  const { stdin, stdout } = process;
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write(value ? `recebida (${value.length} caracteres)\n` : "pulado\n");
      resolve(value.trim());
    };
    const onData = (chunk) => {
      // remove sequências de escape (colagem entre colchetes, setas)
      for (const ch of chunk.replace(/\x1b\[[0-9;]*[~A-Za-z]/g, "")) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** Janela do Windows com campo mascarado; a chave volta pelo pipe, sem passar pelo disco. */
function askWindow(label) {
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms",
    `$f = New-Object Windows.Forms.Form -Property @{ Text = 'Prospecta (teste isolado): chave de IA'; Width = 470; Height = 175; StartPosition = 'CenterScreen'; TopMost = $true; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; MinimizeBox = $false }`,
    `$l = New-Object Windows.Forms.Label -Property @{ Text = 'Cole a chave da ${label}. Ela fica só na memória da API de teste.'; Left = 12; Top = 12; Width = 430 }`,
    "$t = New-Object Windows.Forms.TextBox -Property @{ Left = 12; Top = 40; Width = 430; UseSystemPasswordChar = $true }",
    "$ok = New-Object Windows.Forms.Button -Property @{ Text = 'OK'; Left = 286; Top = 80; Width = 75; DialogResult = 'OK' }",
    "$no = New-Object Windows.Forms.Button -Property @{ Text = 'Cancelar'; Left = 367; Top = 80; Width = 75; DialogResult = 'Cancel' }",
    "$f.Controls.AddRange(@($l, $t, $ok, $no)); $f.AcceptButton = $ok; $f.CancelButton = $no; $f.Add_Shown({ $f.Activate(); $t.Focus() })",
    "if ($f.ShowDialog() -eq 'OK') { [Console]::Out.Write($t.Text) }",
  ].join("; ");
  // windowsHide esconderia também o formulário (é a primeira janela do processo); quem some é só o console
  const r = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", ps], { encoding: "utf8", windowsHide: false });
  return (r.stdout ?? "").trim();
}

function setKey([name, label, prefix], v) {
  if (!v) return;
  if (v.startsWith("gsk_") && prefix !== "gsk_") console.warn(`    aviso: "gsk_" é chave da Groq (console.groq.com), não de ${label}; use --chave=groq.`);
  else if (!v.startsWith(prefix) || (prefix === "sk-" && v.startsWith("sk-ant-"))) console.warn(`    aviso: chaves de ${label} costumam começar com "${prefix}"; confira se colou a chave certa.`);
  env[name] = v;
  console.log(`Chave de ${label} recebida (${v.length} caracteres).`);
}

const which = process.argv[2];
const oneKey = process.argv.find((a) => a.startsWith("--chave="))?.slice("--chave=".length);
if (which === "api" && oneKey) {
  const entry = AI_KEYS.find((k) => k[3] === oneKey);
  if (!entry) {
    console.error(`Provedor desconhecido: ${oneKey}. Use openai, anthropic, xai, gemini ou groq.`);
    process.exit(1);
  }
  console.log(`Aguardando a chave de ${entry[1]} na janela que abriu...`);
  setKey(entry, askWindow(entry[1]));
  if (!env[entry[0]]) console.warn("Nenhuma chave informada: a API sobe sem provedor de IA.");
} else if (which === "api" && process.argv.includes("--chaves")) {
  if (!process.stdin.isTTY) {
    console.error("--chaves precisa de um terminal interativo.");
    process.exit(1);
  }
  console.log("Cole a chave de cada provedor que quiser testar (Enter pula). Nada é exibido nem gravado.");
  for (const entry of AI_KEYS) setKey(entry, await askHidden(`  ${entry[1]}: `));
  if (!AI_KEYS.some(([name]) => env[name])) console.warn("Nenhuma chave informada: a API sobe sem provedor de IA.");
}

if (which === "api") {
  const pg = createRequire(join(platform, "api", "package.json"))("pg");
  const url = new URL(env.DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Banco não é local: recusado.");
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const r = await client.query("SELECT shobj_description(oid, 'pg_database') AS mark FROM pg_database WHERE datname = current_database()");
  await client.end();
  if (r.rows[0]?.mark !== "prospecta:descartavel") throw new Error("Banco sem a marca de descartável: recusado.");
  // a migração não precisa das chaves de IA
  const noKeys = Object.fromEntries(AI_KEYS.map(([name]) => [name, ""]));
  const migrate = spawn("npx", ["prisma", "migrate", "deploy"], { cwd: join(platform, "api"), env: { ...process.env, ...env, ...noKeys }, stdio: "inherit", shell: true });
  migrate.on("exit", (code) => {
    if (code !== 0) process.exit(code ?? 1);
    // watch: recarrega ao mudar o código mantendo as chaves que estão só na memória deste processo
    spawn("npx", ["tsx", "watch", "src/server.ts"], { cwd: join(platform, "api"), env: { ...process.env, ...env }, stdio: "inherit", shell: true }).on("exit", (c) => process.exit(c ?? 0));
  });
} else if (which === "web") {
  spawn("npx", ["next", "dev", "-p", "3100", "-H", "127.0.0.1"], { cwd: join(platform, "web"), env: { ...process.env, API_PROXY_URL: `http://127.0.0.1:${env.PORT}` }, stdio: "inherit", shell: true }).on("exit", (c) => process.exit(c ?? 0));
} else {
  console.error("Uso: node platform/scripts/dev-isolado.mjs api|web");
  process.exit(1);
}
