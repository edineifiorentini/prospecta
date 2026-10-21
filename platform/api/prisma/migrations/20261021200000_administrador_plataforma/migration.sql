-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;

-- Em instalações existentes, o administrador da plataforma é quem é Proprietário da primeira
-- organização criada (quem instalou o sistema). Usuários convidados para ela não recebem o papel.
UPDATE "users" SET "is_platform_admin" = true
WHERE "id" IN (
  SELECT m."user_id" FROM "memberships" m
  WHERE m."role" = 'OWNER'
    AND m."organization_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1)
);
