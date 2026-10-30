import type { Role } from "../../lib/prisma.ts";

/** Permissões por recurso. A API sempre verifica permissão + organização do recurso. */
export type Permission =
  | "read"
  | "crm:write"
  | "tasks:write"
  | "companies:write"
  | "companies:delete"
  | "search:run"
  | "import:run"
  | "enrich:run"
  | "audit:run"
  /** gerar análise comercial com IA (consome tokens dentro dos limites da conta) */
  | "ai:run"
  | "export:run"
  | "messages:send"
  | "messages:approve"
  | "messaging:manage"
  | "consent:manage"
  | "settings:manage"
  | "users:manage"
  | "privacy:manage"
  | "auditlog:read";

const SALES: Permission[] = ["read", "crm:write", "tasks:write", "companies:write", "enrich:run", "audit:run", "ai:run", "messages:send", "consent:manage"];
const MANAGER: Permission[] = [...SALES, "search:run", "import:run", "export:run", "messages:approve", "auditlog:read"];
const ADMIN: Permission[] = [...MANAGER, "companies:delete", "messaging:manage", "settings:manage", "users:manage", "privacy:manage"];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  VIEWER: new Set(["read"]),
  SALES: new Set(SALES),
  MANAGER: new Set(MANAGER),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(ADMIN),
};

export const can = (role: Role, permission: Permission) => MATRIX[role]?.has(permission) ?? false;
export const permissionsOf = (role: Role) => [...(MATRIX[role] ?? [])];

const RANK: Record<Role, number> = { VIEWER: 0, SALES: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };
/** Um usuário só pode atribuir papéis de nível igual ou inferior ao seu (OWNER apenas por OWNER). */
export const canAssignRole = (actor: Role, target: Role) => RANK[actor] >= RANK[target] && (target !== "OWNER" || actor === "OWNER");
