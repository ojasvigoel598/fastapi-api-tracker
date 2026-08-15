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
