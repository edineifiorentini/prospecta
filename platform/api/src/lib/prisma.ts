import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { env } from "../config/env.ts";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: env.ROLE === "worker" ? 8 : 15 }),
});

export type Db = typeof prisma;
export * from "../generated/prisma/client.ts";
