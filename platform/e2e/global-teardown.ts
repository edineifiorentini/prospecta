import { rmSync } from "node:fs";
import { E2E_EMAIL, PREFIX, STATE, sql } from "./lib.ts";

/** Remove os registros criados pelos testes e desativa o usuário de teste. */
export default async function globalTeardown() {
  sql(`DELETE FROM companies WHERE name LIKE '${PREFIX}%'`);
  sql(`DELETE FROM suppression_list WHERE value LIKE '%@e2e.example'`);
  sql(`UPDATE users SET is_active = false WHERE email = '${E2E_EMAIL}'`);
  sql(`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE email = '${E2E_EMAIL}')`);
  rmSync(STATE, { force: true });
  rmSync(STATE.replace("state.json", "user.json"), { force: true });
}
