import { rmSync } from "node:fs";
import { E2E_EMAIL, PREFIX, STATE, sql } from "./lib.ts";

/** Remove os registros e o usuário criados pelos testes (o histórico de outras empresas fica sem autor). */
export default async function globalTeardown() {
  sql(`DELETE FROM companies WHERE name LIKE '${PREFIX}%'`);
  sql(`DELETE FROM suppression_list WHERE value LIKE '%@e2e.example'`);
  sql(`DELETE FROM users WHERE email = '${E2E_EMAIL}'`);
  rmSync(STATE, { force: true });
  rmSync(STATE.replace("state.json", "user.json"), { force: true });
}
