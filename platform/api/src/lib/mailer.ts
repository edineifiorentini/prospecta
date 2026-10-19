import nodemailer from "nodemailer";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

const transport = nodemailer.createTransport(env.SMTP_URL);

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
    return true;
  } catch (err) {
    logger.error({ err: (err as Error).message, subject }, "falha ao enviar e-mail");
    return false;
  }
}
