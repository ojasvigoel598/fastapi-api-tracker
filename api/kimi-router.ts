import { createRouter, authedQuery } from "./middleware";
import { analyzeMonitoring, kimiStatus } from "./kimi/ai";

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

  analyze: authedQuery.mutation(({ ctx }) => analyzeMonitoring(ctx.user.id)),
});
