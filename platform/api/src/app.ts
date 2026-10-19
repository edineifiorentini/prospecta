import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { env } from "./config/env.ts";
import { loggerOptions } from "./lib/logger.ts";
import { AppError } from "./lib/errors.ts";
import { redis } from "./lib/redis.ts";
import authPlugin from "./plugins/auth.ts";
import { registerRoutes } from "./routes.ts";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : loggerOptions,
    trustProxy: "127.0.0.1/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: false, // a API só responde JSON/arquivos; o CSP da interface fica no Next.js
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    redis,
    nameSpace: "pp-rl:",
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      code: "RATE_LIMITED",
      message: `Muitas requisições. Tente novamente em ${Math.ceil(ctx.ttl / 1000)} s.`,
    }),
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Prospecta API",
        description:
          "API REST da plataforma local de prospecção e CRM. Autenticação por cookie de sessão HttpOnly (`pp_session`) e cabeçalho `x-csrf-token` em requisições de escrita.",
        version: "0.1.0",
      },
      servers: [{ url: "/" }],
      components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "pp_session" } } },
      security: [{ session: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs", uiConfig: { docExpansion: "list", deepLinking: true } });

  await app.register(authPlugin);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Dados inválidos.",
        details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, "erro de serialização de resposta");
      return reply.code(500).send({ statusCode: 500, code: "INTERNAL", message: "Erro interno." });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ statusCode: err.statusCode, code: err.code, message: err.message, details: err.details });
    }
    if (err.statusCode === 429) return reply.code(429).send(err);
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ statusCode: err.statusCode, code: err.code ?? "ERROR", message: err.message });
    }
    req.log.error({ err }, "erro não tratado");
    return reply.code(500).send({ statusCode: 500, code: "INTERNAL", message: "Erro interno. O incidente foi registrado." });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ statusCode: 404, code: "NOT_FOUND", message: "Rota não encontrada." }));

  await app.register(registerRoutes, { prefix: "/api" });
  return app;
}
