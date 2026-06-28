import nodemailer from "nodemailer";
import type { GmailCredentials } from "./types";

type TransportFactory = typeof nodemailer.createTransport;

export async function verifyGmailSmtp(
  credentials: GmailCredentials,
  createTransport: TransportFactory = nodemailer.createTransport,
): Promise<{ ok: true } | { ok: false; error: "gmail_auth_failed" | "gmail_smtp_unavailable" }> {
  const transport = createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth: { user: credentials.email, pass: credentials.appPassword },
  });
  try {
    await transport.verify();
    return { ok: true };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return { ok: false, error: code === "EAUTH" ? "gmail_auth_failed" : "gmail_smtp_unavailable" };
  } finally {
    transport.close();
  }
}
