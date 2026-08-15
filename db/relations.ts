import { relations } from "drizzle-orm";
import { users, alerts } from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  acknowledgedAlerts: many(alerts),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  acknowledgedByUser: one(users, {
    fields: [alerts.acknowledgedBy],
    references: [users.id],
  }),
}));
