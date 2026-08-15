/**
 * Optional Kimi (Moonshot AI) integration.
 *
 * Kimi is ONLY used for AI features — it is never part of application
 * authentication. Three states:
 *
 *   1. not_connected — no Kimi configuration; core app works normally.
 *   2. mock           — deterministic local analysis (demo mode), no API calls.
 *   3. real           — a real Kimi completion, only when KIMI_OPEN_URL and
 *                       KIMI_API_KEY are configured.
 */

import { env } from "../lib/env";
import { getOverviewMetrics, generateInsights } from "../queries/monitoring";

export type KimiStatus = "not_connected" | "mock" | "real";

export function kimiStatus(): KimiStatus {
  if (env.kimiOpenUrl && env.kimiApiKey) return "real";
  if (env.isDemoMode) return "mock";
  return "not_connected";
}

function buildMockAnalysis(overview: {
  totalRequests: number;
  failureRate: number;
  avgLatencyMs: number;
  activeEndpoints: number;
}, insights: { message: string }[]): string {
  const lines = [
    "Here's a deterministic summary of your API monitoring data:",
    `- ${overview.totalRequests.toLocaleString()} requests observed, with a ${overview.failureRate.toFixed(1)}% failure rate.`,
    `- Average latency is ${overview.avgLatencyMs.toFixed(0)}ms across ${overview.activeEndpoints} active endpoints.`,
  ];
  if (insights.length > 0) {
    lines.push(
      `- Notable findings: ${insights.map((i) => i.message.toLowerCase()).join("; ")}.`,
    );
  } else {
    lines.push("- No anomalies detected in the current window.");
  }
  return lines.join("\n");
}

export async function analyzeMonitoring(userId: number): Promise<{
  state: KimiStatus;
  analysis: string;
}> {
  const state = kimiStatus();

  if (state === "real") {
    const overview = await getOverviewMetrics("24h", userId);
    const prompt = [
      "Summarize this API monitoring data for an engineer:",
      `total requests: ${overview.totalRequests}`,
      `failure rate: ${overview.failureRate}%`,
      `average latency: ${overview.avgLatencyMs}ms`,
      `active endpoints: ${overview.activeEndpoints}`,
    ].join("\n");

    try {
      const resp = await fetch(`${env.kimiOpenUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.kimiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "moonshot-v1-8k",
          messages: [
            {
              role: "system",
              content: "You are a concise API monitoring assistant.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      });
      if (!resp.ok) {
        // Fall back to the deterministic mock rather than crashing.
        const overview2 = await getOverviewMetrics("24h", userId);
        const insights2 = await generateInsights("24h", userId);
        return { state: "mock", analysis: buildMockAnalysis(overview2, insights2) };
      }
      const json = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return {
        state: "real",
        analysis: json.choices?.[0]?.message?.content ?? "Kimi returned no content.",
      };
    } catch {
      const overview2 = await getOverviewMetrics("24h", userId);
      const insights2 = await generateInsights("24h", userId);
      return { state: "mock", analysis: buildMockAnalysis(overview2, insights2) };
    }
  }

  const overview = await getOverviewMetrics("24h", userId);
  const insights = await generateInsights("24h", userId);
  return { state, analysis: buildMockAnalysis(overview, insights) };
}
