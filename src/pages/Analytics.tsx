/**
 * Analytics Page
 *
 * Deep-dive analytics with:
 * - Latency trend line chart over time
 * - Failure rate trend chart
 * - Status code breakdown
 * - Method distribution
 * - Latency percentiles by endpoint
 * - Performance bottleneck detection
 */

import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  TrendingUp,
  AlertTriangle,
  Zap,
  BarChart3,
  Clock,
  Server,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import type { TimeRange } from "../../api/queries/time-range";
import TimeRangePicker from "@/components/TimeRangePicker";
import { toTimeRangeQuery } from "@/lib/time-range";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

const LATENCY_COLORS = ["#22c55e", "#86efac", "#fbbf24", "#f59e0b", "#ef4444", "#dc2626"];
const METHOD_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"];

function formatTime(ts: string | Date, range: TimeRange): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (range === "1h" || range === "6h") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "24h") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const rangeQuery = useMemo(
    () => toTimeRangeQuery(timeRange, startDate, endDate),
    [timeRange, startDate, endDate],
  );

  const { data: timeSeries, isLoading: tsLoading } =
    trpc.monitoring.timeSeries.useQuery({ ...rangeQuery, groupBy: "hour" });

  const { data: statusDistribution, isLoading: statusLoading } =
    trpc.monitoring.statusDistribution.useQuery(rangeQuery);

  const { data: latencyDistribution, isLoading: latLoading } =
    trpc.monitoring.latencyDistribution.useQuery(rangeQuery);

  const { data: methodDistribution, isLoading: methodLoading } =
    trpc.monitoring.methodDistribution.useQuery(rangeQuery);

  const { data: endpoints, isLoading: epLoading } =
    trpc.monitoring.endpoints.useQuery({ ...rangeQuery, limit: 10 });

  const { data: insights } = trpc.monitoring.insights.useQuery(rangeQuery);

  const latencyChartData = useMemo(() => {
    if (!latencyDistribution) return [];
    return latencyDistribution.map((l, i) => ({
      name: l.bucket,
      value: l.count,
      fill: LATENCY_COLORS[i] || "#9ca3af",
    }));
  }, [latencyDistribution]);

  const methodChartData = useMemo(() => {
    if (!methodDistribution) return [];
    return methodDistribution.map((m, i) => ({
      name: m.method,
      value: m.count,
      fill: METHOD_COLORS[i] || "#9ca3af",
      percentage: m.percentage,
    }));
  }, [methodDistribution]);

  const failureRateData = useMemo(() => {
    if (!timeSeries) return [];
    return timeSeries.map((ts) => ({
      timestamp: ts.timestamp,
      failureRate: ts.total > 0 ? Math.round((ts.failed / ts.total) * 100 * 100) / 100 : 0,
      total: ts.total,
      failed: ts.failed,
    }));
  }, [timeSeries]);

  const latencyTrendData = useMemo(() => {
    if (!timeSeries) return [];
    return timeSeries.map((ts) => ({
      timestamp: ts.timestamp,
      avgLatency: ts.avgLatency,
    }));
  }, [timeSeries]);

  const bottlenecks = useMemo(() => {
    if (!endpoints) return [];
    return [...endpoints]
      .filter((ep) => ep.totalRequests >= 5)
      .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
      .slice(0, 5);
  }, [endpoints]);

  return (
    <AuthLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Deep-dive performance analysis and trends
            </p>
          </div>
          <TimeRangePicker
            value={timeRange}
            onChange={setTimeRange}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
        </div>

        {/* Charts Row 1: Latency Trend + Failure Rate */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Latency Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tsLoading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={latencyTrendData}>
                    <defs>
                      <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts: string | Date) => formatTime(ts, timeRange)}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickFormatter={(v: number) => `${v}ms`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value: number) => [`${value}ms`, "Avg Latency"]}
                      labelFormatter={(ts: string | Date) => {
                        const d = ts instanceof Date ? ts : new Date(ts);
                        return d.toLocaleString();
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgLatency"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      name="Avg Latency"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary" />
                Failure Rate Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tsLoading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={failureRateData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts: string | Date) => formatTime(ts, timeRange)}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(value: number) => [`${value}%`, "Failure Rate"]}
                      labelFormatter={(ts: string | Date) => {
                        const d = ts instanceof Date ? ts : new Date(ts);
                        return d.toLocaleString();
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="failureRate"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      name="Failure Rate %"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2: Distributions */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Status Code Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : (
                <div className="space-y-2">
                  {(statusDistribution ?? []).map((s) => {
                    const isError = s.statusCode >= 400;
                    return (
                      <div key={s.statusCode} className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[10px] font-mono w-14 justify-center ${
                            s.statusCode < 300
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : s.statusCode < 400
                                ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                                : s.statusCode < 500
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                  : "bg-red-500/10 text-red-700 dark:text-red-400"
                          }`}
                        >
                          {s.statusCode}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isError ? "bg-red-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(s.percentage, 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground w-14 text-right shrink-0">
                          {s.percentage.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Latency Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latLoading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={latencyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                    <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="value" name="Requests" radius={[4, 4, 0, 0]}>
                      {latencyChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Method Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {methodLoading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : (
                <div className="space-y-3">
                  {methodChartData.map((m) => (
                    <div key={m.name} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: m.fill }}
                          />
                          <span className="text-sm font-medium">{m.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {m.percentage.toFixed(1)}% ({m.value.toLocaleString()})
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(m.percentage, 100)}%`,
                            background: m.fill,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row: Performance Bottlenecks */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Performance Bottlenecks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {epLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : bottlenecks.length > 0 ? (
                <div className="space-y-2">
                  {bottlenecks.map((ep, i) => {
                    const isSlow = ep.avgLatencyMs > 500;
                    const isVerySlow = ep.avgLatencyMs > 1000;
                    return (
                      <div
                        key={ep.path}
                        className="flex items-center gap-4 py-2.5 border-b last:border-0"
                      >
                        <span className="text-xs text-muted-foreground w-6 shrink-0">
                          #{i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] font-mono shrink-0"
                            >
                              {ep.method}
                            </Badge>
                            <span className="text-sm font-medium truncate">
                              {ep.path}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{ep.totalRequests.toLocaleString()} requests</span>
                            <span>
                              {ep.failedRequests > 0 && (
                                <span className="text-red-500">
                                  {((ep.failedRequests / ep.totalRequests) * 100).toFixed(1)}% failed
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`text-sm font-mono font-semibold ${
                              isVerySlow
                                ? "text-red-600 dark:text-red-400"
                                : isSlow
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                            }`}
                          >
                            {ep.avgLatencyMs.toFixed(0)}ms
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            max {ep.maxLatencyMs}ms
                          </div>
                        </div>
                        {isSlow && (
                          <ArrowUpRight
                            className={`h-4 w-4 shrink-0 ${
                              isVerySlow ? "text-red-500" : "text-amber-500"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                  <p>No performance data available</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary" />
                Recent Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              {insights && insights.length > 0 ? (
                <div className="space-y-3">
                  {insights.map((insight, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 ${
                        insight.type === "critical"
                          ? "bg-red-500/5 border-red-500/20"
                          : insight.type === "warning"
                            ? "bg-amber-500/5 border-amber-500/20"
                            : "bg-blue-500/5 border-blue-500/20"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {insight.type === "critical" ? (
                          <ArrowUpRight className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                        ) : insight.type === "warning" ? (
                          <ArrowUpRight className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{insight.message}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {insight.detail}
                          </p>
                          {insight.endpoint && (
                            <Badge variant="outline" className="text-[10px] mt-1.5">
                              {insight.endpoint}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                  <p>No insights for this period</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthLayout>
  );
}
