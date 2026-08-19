import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { analyzeMonitoring, kimiStatus } from "./kimi/ai";
import { consumeApiLimit, requestIp, apiLimitLabel } from "./lib/api-rate-limit";

export const kimiRouter = createRouter({
  status: authedQuery.query(() => ({
    state: kimiStatus(),
    label:
      kimiStatus() === "real"
        ? "Kimi connected"
        : kimiStatus() === "mock"
          ? "Mock Kimi (deterministic, no API calls)"
          : "Kimi not connected",
  })),

  analyze: authedQuery.mutation(({ ctx }) => {
    const limit = consumeApiLimit("kimi", `user:${ctx.user.id}`, requestIp(ctx.req.headers));
    if (!limit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `AI analysis is limited to ${apiLimitLabel("kimi")}. Try again shortly.`,
      });
    }
    return analyzeMonitoring(ctx.user.id);
  }),
});
