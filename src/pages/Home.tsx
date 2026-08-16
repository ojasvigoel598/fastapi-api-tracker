/**
 * Dashboard Overview Page
 *
 * Main landing page with:
 * - KPI metric cards (total requests, failure rate, avg latency, active endpoints)
 * - Request volume + failure rate time-series chart
 * - Status code distribution pie chart
 * - Latency distribution bar chart
 * - Automated insights panel
 * - Recent alerts preview
 * - Top endpoints table
 */

import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Zap,
  TrendingUp,
  AlertCircle,
  Info,
  XCircle,
  Server,
} from "lucide-react";
import { useNavigate } from "react-router";
import type { TimeRange } from "../../api/queries/time-range";
import TimeRangePicker from "@/components/TimeRangePicker";
import { toTimeRangeQuery } from "@/lib/time-range";
import { FailureDetailDialog } from "@/components/FailureDetailDialog";
import { shortFailureReason, type FailureRequest } from "@/lib/failures";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

const STATUS_COLORS: Record<number, string> = {
  200: "#22c55e",
  201: "#22c55e",
  204: "#86efac",
  301: "#3b82f6",
  302: "#3b82f6",
  304: "#60a5fa",
  400: "#f59e0b",
  401: "#f97316",
  403: "#f97316",
  404: "#f59e0b",
  422: "#f59e0b",
  429: "#f59e0b",
  500: "#ef4444",
  502: "#dc2626",
  503: "#dc2626",
  504: "#dc2626",
};

const LATENCY_COLORS = ["#22c55e", "#86efac", "#fbbf24", "#f59e0b", "#ef4444", "#dc2626"];

function getStatusBadgeClass(code: number): string {
  if (code >= 200 && code < 300)
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (code >= 300 && code < 400)
    return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
  if (code >= 400 && code < 500)
    return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function MetricCard({
  title,
  value,
  change,
  icon: Icon,
  changeLabel,
  isLoading,
}: {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ElementType;
  changeLabel?: string;
  isLoading?: boolean;
}) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold tracking-tight">{value}</p>
            )}
            {change !== undefined && !isLoading && (
              <div className="flex items-center gap-1.5">
                {isPositive ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-destructive" />
                ) : isNegative ? (
                  <ArrowDownRight className="h-3.5 w-3.5 text-emerald-500" />
                ) : null}
                <span
                  className={`text-xs font-medium ${
                    isPositive
                      ? "text-destructive"
                      : isNegative
                        ? "text-emerald-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {change > 0 ? "+" : ""}
                  {change}%
                </span>
                {changeLabel && (
                  <span className="text-xs text-muted-foreground">
                    {changeLabel}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InsightCard({
  type,
  message,
  detail,
  endpoint,
}: {
  type: "warning" | "critical" | "info";
  message: string;
  detail: string;
  endpoint?: string;
}) {
  const config = {
    warning: {
      icon: AlertTriangle,
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
      text: "text-amber-700 dark:text-amber-400",
      iconColor: "text-amber-500",
    },
    critical: {
      icon: XCircle,
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      text: "text-red-700 dark:text-red-400",
      iconColor: "text-red-500",
    },
    info: {
      icon: Info,
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      text: "text-blue-700 dark:text-blue-400",
      iconColor: "text-blue-500",
    },
  };

  const c = config[type];
  const Icon = c.icon;

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-3.5`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${c.iconColor}`} />
        <div className="space-y-1 min-w-0">
          <p className={`text-sm font-medium ${c.text}`}>{message}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {detail}
          </p>
          {endpoint && (
            <Badge variant="outline" className="text-xs mt-1">
              {endpoint}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [failureLimit, setFailureLimit] = useState(30);
  const [selectedFailure, setSelectedFailure] = useState<FailureRequest | null>(null);
  const navigate = useNavigate();
  const rangeQuery = useMemo(
    () => toTimeRangeQuery(timeRange, startDate, endDate),
    [timeRange, startDate, endDate],
  );

  // Poll so telemetry pushed through the webhook (/api/webhook/ingest) or
  // POST /api/ingest shows up on the dashboard without a manual refresh.
  const live = { refetchInterval: 10_000 } as const;

  const { data: overview, isLoading: overviewLoading } =
    trpc.monitoring.overview.useQuery(rangeQuery, live);

  const { data: timeSeries, isLoading: timeSeriesLoading } =
    trpc.monitoring.timeSeries.useQuery({ ...rangeQuery, groupBy: "hour" }, live);

  const { data: statusDistribution, isLoading: statusLoading } =
    trpc.monitoring.statusDistribution.useQuery(rangeQuery);

  const { data: latencyDistribution, isLoading: latencyLoading } =
    trpc.monitoring.latencyDistribution.useQuery(rangeQuery);

  const { data: insights, isLoading: insightsLoading } =
    trpc.monitoring.insights.useQuery(rangeQuery);

  const { data: alerts } = trpc.monitoring.alerts.useQuery(
    { acknowledged: false },
    live,
  );

  const { data: topEndpoints } = trpc.monitoring.endpoints.useQuery({
    ...rangeQuery,
    limit: 5,
  });

  const { data: failures } = trpc.monitoring.failures.useQuery({
    page: 1,
    pageSize: failureLimit,
  });

  const statusChartData = useMemo(() => {
    if (!statusDistribution) return [];
    return statusDistribution.map((s) => ({
      name: `${s.statusCode}`,
      value: s.count,
      percentage: s.percentage,
      color: STATUS_COLORS[s.statusCode] || "#9ca3af",
    }));
  }, [statusDistribution]);

  const latencyChartData = useMemo(() => {
    if (!latencyDistribution) return [];
    return latencyDistribution.map((l, i) => ({
      name: l.bucket,
      value: l.count,
      fill: LATENCY_COLORS[i] || "#9ca3af",
    }));
  }, [latencyDistribution]);

  const activeAlerts = alerts?.filter((a) => !a.acknowledged).slice(0, 5) ?? [];

  const failureItems = failures?.items ?? [];
  const failureTotal = failures?.total ?? 0;
  const hasMoreFailures = failureTotal > failureItems.length;

  return (
    <AuthLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Measured API performance for the selected period
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

        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Requests"
            value={formatNumber(overview?.totalRequests ?? 0)}
            change={overview?.requestsChangePercent}
            changeLabel="vs previous period"
            icon={Activity}
            isLoading={overviewLoading}
          />
          <MetricCard
            title="Failure Rate"
            value={`${overview?.failureRate ?? 0}%`}
            change={overview?.failureRateChangePercent}
            changeLabel="vs previous period"
            icon={AlertTriangle}
            isLoading={overviewLoading}
          />
          <MetricCard
            title="Avg Latency"
            value={`${overview?.avgLatencyMs ?? 0}ms`}
            icon={Clock}
            isLoading={overviewLoading}
          />
          <MetricCard
            title="Active Endpoints"
            value={overview?.activeEndpoints ?? 0}
            icon={Globe}
            isLoading={overviewLoading}
          />
        </div>

        {/* Charts Row 1 */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Request Volume Chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Request Volume & Failures
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timeSeriesLoading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={timeSeries ?? []}>
                    <defs>
                      <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="failedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts: string | Date) => {
                        const d = ts instanceof Date ? ts : new Date(ts);
                        return d.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                      }}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(ts: string | Date) => {
                        const d = ts instanceof Date ? ts : new Date(ts);
                        return d.toLocaleString();
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Total Requests"
                      stroke="hsl(var(--primary))"
                      fillOpacity={1}
                      fill="url(#totalFill)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      name="Failed"
                      stroke="#ef4444"
                      fillOpacity={1}
                      fill="url(#failedFill)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Status Code Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                Status Codes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statusLoading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={statusChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                    >
                      {statusChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string, props: { payload?: { percentage?: number } }) => [
                        `${value} (${props?.payload?.percentage ?? 0}%)`,
                        `Status ${name}`,
                      ]}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Latency Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Latency Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latencyLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
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

          {/* Automated Insights */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-primary" />
                Automated Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              {insightsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : insights && insights.length > 0 ? (
                <div className="space-y-2.5">
                  {insights.map((insight, i) => (
                    <InsightCard
                      key={i}
                      type={insight.type}
                      message={insight.message}
                      detail={insight.detail}
                      endpoint={insight.endpoint ?? undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
                  <p className="text-sm font-medium">All systems healthy</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    No issues detected in the current period
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row: Top Endpoints + Recent Alerts */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Top Endpoints */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                Top Endpoints
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/endpoints")}
              >
                View All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(topEndpoints ?? []).slice(0, 5).map((ep) => {
                  const failRate =
                    ep.totalRequests > 0
                      ? (ep.failedRequests / ep.totalRequests) * 100
                      : 0;
                  return (
                    <div
                      key={ep.path}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div className="min-w-0 flex-1">
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
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 ml-4">
                        <span>{ep.totalRequests.toLocaleString()} req</span>
                        <span
                          className={`${failRate > 5 ? "text-destructive font-medium" : ""}`}
                        >
                          {failRate.toFixed(1)}% fail
                        </span>
                        <span>{ep.avgLatencyMs.toFixed(0)}ms</span>
                      </div>
                    </div>
                  );
                })}
                {(!topEndpoints || topEndpoints.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No endpoint data available
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Alerts */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary" />
                Active Alerts
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/alerts")}
              >
                View All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {activeAlerts.length > 0 ? (
                  activeAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 py-2 border-b last:border-0"
                    >
                      {alert.severity === "critical" ? (
                        <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      ) : alert.severity === "warning" ? (
                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      ) : (
                        <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {alert.message}
                        </p>
                        {alert.endpoint && (
                          <Badge variant="outline" className="text-[10px] mt-1">
                            {alert.endpoint}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
                    <p className="text-sm font-medium">No active alerts</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      All alerts have been acknowledged
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Failures */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              Recent Failures
            </CardTitle>
            <Badge variant="outline" className="text-[10px] font-mono">
              {failureTotal.toLocaleString()} failed requests
            </Badge>
          </CardHeader>
          <CardContent>
            {failureItems.length > 0 ? (
              <div className="space-y-0.5">
                {failureItems.map((req) => (
                  <button
                    key={req.id}
                    onClick={() => setSelectedFailure(req)}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60 transition-colors"
                  >
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-mono shrink-0 ${getStatusBadgeClass(req.statusCode)}`}
                    >
                      {req.statusCode}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono shrink-0 bg-muted"
                    >
                      {req.method}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {req.endpoint}
                    </span>
                    <span className="hidden md:block max-w-[40%] truncate text-xs text-muted-foreground">
                      {shortFailureReason(req)}
                    </span>
                    <span className="hidden sm:block shrink-0 text-xs text-muted-foreground">
                      {req.createdAt.toLocaleString()}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
                <p className="text-sm font-medium">No failures recorded</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Failed requests will appear here as they are tracked.
                </p>
              </div>
            )}
            {hasMoreFailures && (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFailureLimit((l) => Math.min(l + 30, 500))}
                >
                  Show More
                  <ChevronDown className="h-4 w-4 ml-1.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <FailureDetailDialog
        request={selectedFailure}
        open={selectedFailure !== null}
        onOpenChange={(o) => !o && setSelectedFailure(null)}
      />
    </AuthLayout>
  );
}
