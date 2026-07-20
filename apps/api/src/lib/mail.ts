import nodemailer from "nodemailer";
import { env } from "../config/env.js";
const transport = env.SMTP_HOST ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, ...(env.SMTP_USER && env.SMTP_PASSWORD ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}) }) : null;
export async function sendMail(input: { to: string; subject: string; text: string }): Promise<"sent" | "disabled"> { if (!transport) { if (env.APP_ENV === "production") throw new Error("SMTP indisponível"); return "disabled"; } await transport.sendMail({ from: env.SMTP_FROM, to: input.to, subject: input.subject, text: input.text }); return "sent"; }
export async function verifyMailTransport(): Promise<boolean> { if (!transport) return env.APP_ENV !== "production"; try { await transport.verify(); return true; } catch { return false; } }
