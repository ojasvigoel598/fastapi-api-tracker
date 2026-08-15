export const TIME_RANGES = [
  "1h",
  "6h",
  "24h",
  "7d",
  "30d",
  "90d",
  "thisMonth",
  "lastMonth",
  "thisYear",
  "custom",
] as const;

export type TimeRange = (typeof TIME_RANGES)[number];

export type DateBounds = {
  since: Date;
  until: Date;
};

function addDuration(now: number, durationMs: number): DateBounds {
  return {
    since: new Date(now - durationMs),
    until: new Date(now),
  };
}

/** Resolve a preset or explicit ISO range using the server's local calendar. */
export function getDateBounds(
  range: TimeRange = "24h",
  startDate?: Date,
  endDate?: Date,
  now = new Date(),
): DateBounds {
  if (range === "custom" && startDate && endDate) {
    const since = startDate.getTime() <= endDate.getTime() ? startDate : endDate;
    const until = startDate.getTime() <= endDate.getTime() ? endDate : startDate;
    return { since, until };
  }

  const nowMs = now.getTime();
  switch (range) {
    case "1h":
      return addDuration(nowMs, 60 * 60 * 1000);
    case "6h":
      return addDuration(nowMs, 6 * 60 * 60 * 1000);
    case "24h":
      return addDuration(nowMs, 24 * 60 * 60 * 1000);
    case "7d":
      return addDuration(nowMs, 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return addDuration(nowMs, 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return addDuration(nowMs, 90 * 24 * 60 * 60 * 1000);
    case "thisMonth":
      return { since: new Date(now.getFullYear(), now.getMonth(), 1), until: now };
    case "lastMonth": {
      const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const until = new Date(now.getFullYear(), now.getMonth(), 1);
      until.setMilliseconds(until.getMilliseconds() - 1);
      return { since, until };
    }
    case "thisYear":
      return { since: new Date(now.getFullYear(), 0, 1), until: now };
    case "custom":
    default:
      return addDuration(nowMs, 24 * 60 * 60 * 1000);
  }
}
