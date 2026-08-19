/**
 * Email notifications for usage-limit alerts.
 *
 * Uses Resend (https://resend.com) — a single REST call, no SDK required.
 * When `RESEND_API_KEY` is not configured, sending is a safe no-op and the
 * alert is still recorded (with `emailed: 0`) so the dashboard remains
 * fully functional without credentials.
 *
 * Required env vars (server-only, set in the Keys/API Keys tab):
 *   RESEND_API_KEY  — Resend secret API key
 *   RESEND_FROM     — verified "From" address (defaults to a Resend test
 *                     sender which only delivers to your own account email)
 */

import { env } from "./env";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type UsageAlertEmail = {
  to: string;
  subject: string;
  html: string;
};

export type SendResult = { sent: boolean; reason?: string };

export function emailConfigured(): boolean {
  return Boolean(env.resendApiKey);
}

/**
 * Email verification and password reset become available only when both the
 * transport (Resend key) and a public base URL (to build the clickable link)
 * are configured. Without either, the app auto-verifies new sign-ups.
 */
export function authEmailAvailable(): boolean {
  return Boolean(env.resendApiKey && env.appUrl);
}

/**
 * Build the email-verification message. The link points at the app's own
 * verification page, which calls `auth.verifyEmail` with the one-time token.
 */
export function buildVerificationEmail(input: {
  to: string;
  appUrl: string;
  token: string;
  expiresInMinutes: number;
}): UsageAlertEmail {
  const link = `${input.appUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(input.token)}`;
  return {
    to: input.to,
    subject: "Verify your email address",
    html: [
      `<h2>Welcome to the API Tracker</h2>`,
      `<p>Please confirm this email address to activate your account.</p>`,
      `<p><a href="${escapeHtml(link)}">Verify my email</a></p>`,
      `<p>This link expires in ${input.expiresInMinutes} minutes and can be used once.</p>`,
      `<p>If you did not create an account, you can safely ignore this email.</p>`,
    ].join("\n"),
  };
}

/**
 * Build the password-reset message with a one-time reset link.
 */
export function buildResetPasswordEmail(input: {
  to: string;
  appUrl: string;
  token: string;
  expiresInMinutes: number;
}): UsageAlertEmail {
  const link = `${input.appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(input.token)}`;
  return {
    to: input.to,
    subject: "Reset your password",
    html: [
      `<h2>Password reset requested</h2>`,
      `<p>Click the link below to choose a new password for your account.</p>`,
      `<p><a href="${escapeHtml(link)}">Reset my password</a></p>`,
      `<p>This link expires in ${input.expiresInMinutes} minutes and can be used once.</p>`,
      `<p>If you did not request this, you can safely ignore this email — your password stays the same.</p>`,
    ].join("\n"),
  };
}

/**
 * Build the human-readable email for a usage-limit threshold alert.
 */
export function buildUsageAlertEmail(input: {
  apiName: string;
  endpoint: string;
  method: string;
  period: string;
  severity: string;
  used: number;
  limit: number;
  percentage: number;
  occurredAt: Date;
  nextSteps: string;
  dashboardUrl: string;
}): UsageAlertEmail {
  const pct = input.percentage.toFixed(1);
  const subject = `[${input.severity.toUpperCase()}] ${input.apiName} ${input.period} usage ${pct}%`;
  const html = [
    `<h2>API usage alert</h2>`,
    `<p><strong>${input.apiName}</strong> reached the <strong>${input.severity}</strong> threshold.</p>`,
    `<ul>`,
    `<li>API: <code>${escapeHtml(input.method)} ${escapeHtml(input.endpoint)}</code></li>`,
    `<li>Period: ${escapeHtml(input.period)}</li>`,
    `<li>Current usage: <strong>${input.used.toLocaleString()}</strong></li>`,
    `<li>Configured limit: <strong>${input.limit.toLocaleString()}</strong></li>`,
    `<li>Percentage used: <strong>${pct}%</strong></li>`,
    `<li>Alert severity: <strong>${escapeHtml(input.severity)}</strong></li>`,
    `<li>Time: ${input.occurredAt.toISOString()}</li>`,
    `</ul>`,
    `<p><strong>What happens next:</strong> ${escapeHtml(input.nextSteps)}</p>`,
    `<p><a href="${escapeHtml(input.dashboardUrl)}">Open the API Tracker</a></p>`,
  ].join("\n");
  return { to: "", subject, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send an email via Resend. Never throws: failures are reported so the caller
 * can record the alert without an email while keeping the request healthy.
 */
export async function sendEmail(email: UsageAlertEmail): Promise<SendResult> {
  if (!env.resendApiKey) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  const from = env.resendFrom || "API Tracker <onboarding@resend.dev>";

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { sent: false, reason: `Resend ${resp.status}: ${text.slice(0, 200)}` };
    }

    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}
