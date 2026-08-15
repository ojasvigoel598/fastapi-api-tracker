import type { TimeRange } from "../../api/queries/time-range";

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "Last Hour" },
  { value: "6h", label: "Last 6 Hours" },
  { value: "24h", label: "Last 24 Hours" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "thisYear", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

export function toTimeRangeQuery(
  timeRange: TimeRange,
  startDate: string,
  endDate: string,
): {
  timeRange: TimeRange;
  startDate?: string;
  endDate?: string;
} {
  if (timeRange !== "custom" || !startDate || !endDate) return { timeRange };
  return {
    timeRange,
    startDate: new Date(startDate).toISOString(),
    endDate: new Date(endDate).toISOString(),
  };
}
