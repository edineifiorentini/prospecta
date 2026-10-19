import { pino, type LoggerOptions } from "pino";
import { env } from "../config/env.ts";

/** Campos que nunca podem aparecer nos logs. */
export const redactPaths = [
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers.token",
  "req.headers['x-csrf-token']",
  "req.headers['x-hmac-signature']",
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.tokenEncrypted",
  "*.hmacKey",
  "*.hmac_key",
];

export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: "[oculto]" },
  base: { role: env.ROLE },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(loggerOptions);
