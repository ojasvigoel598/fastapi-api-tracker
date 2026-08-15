import { relations } from "drizzle-orm";
import { users, alerts, apiRequests } from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  requests: many(apiRequests),
  alerts: many(alerts),
  acknowledgedAlerts: many(alerts, { relationName: "acknowledgedBy" }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  acknowledgedByUser: one(users, {
    relationName: "acknowledgedBy",
    fields: [alerts.acknowledgedBy],
    references: [users.id],
  }),
}));

export const apiRequestsRelations = relations(apiRequests, ({ one }) => ({
  user: one(users, {
    fields: [apiRequests.userId],
    references: [users.id],
  }),
}));
