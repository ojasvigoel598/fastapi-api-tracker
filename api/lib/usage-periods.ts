/**
 * Usage period helpers.
 *
 * Daily and monthly usage windows are defined in UTC so boundaries are
 * consistent across servers, timezones, and daylight-saving transitions.
 * `periodKey` strings are the dedupe key for threshold alerts: they change
 * when a period rolls over, which is what lets a threshold re-fire after a
 * usage reset without spamming during the same period.
 */

export type UsagePeriod = "daily" | "monthly";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Start of the current UTC day. */
export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Start of the current UTC month. */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** "YYYY-MM-DD" for the current UTC day. */
export function dailyPeriodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

/** "YYYY-MM" for the current UTC month. */
export function monthlyPeriodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
}

export function periodKey(period: UsagePeriod, now: Date): string {
  return period === "daily" ? dailyPeriodKey(now) : monthlyPeriodKey(now);
}

export function periodStart(period: UsagePeriod, now: Date): Date {
  return period === "daily" ? startOfUtcDay(now) : startOfUtcMonth(now);
}
