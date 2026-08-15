/**
 * Endpoints Page
 *
 * Per-endpoint performance analysis:
 * - Sortable table of all endpoints with metrics
 * - Filter by method
 * - Per-endpoint latency distribution
 * - Success/failure breakdown per endpoint
 * - Detailed endpoint drill-down
 */

import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Globe,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  XCircle,
  BarChart3,
  Search,
  Zap,
} from "lucide-react";
import type { TimeRange } from "../../api/queries/monitoring";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

type SortField = "path" | "method" | "totalRequests" | "avgLatencyMs" | "failedRequests";
type SortOrder = "asc" | "desc";

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  POST: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PUT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DELETE: "bg-red-500/10 text-red-700 dark:text-red-400",
  PATCH: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

function getLatencyColorClass(latency: number): string {
  if (latency < 100) return "text-emerald-600 dark:text-emerald-400";
  if (latency < 300) return "text-amber-600 dark:text-amber-400";
  if (latency < 1000) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

const LATENCY_COLORS = ["#22c55e", "#86efac", "#fbbf24", "#f59e0b", "#ef4444", "#dc2626"];

export default function EndpointsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [methodFilter, setMethodFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("totalRequests");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedEndpoint, setSelectedEndpoint] = useState<string | null>(null);

  const { data: endpoints, isLoading } = trpc.monitoring.endpoints.useQuery({
    timeRange,
  });

  const { data: endpointLatency } = trpc.monitoring.latencyDistribution.useQuery(
    {
      timeRange,
      endpoint: selectedEndpoint ?? undefined,
    },
    { enabled: !!selectedEndpoint }
  );

  const filteredEndpoints = useMemo(() => {
    let result = [...(endpoints ?? [])];

    if (methodFilter) {
      result = result.filter((ep) => ep.method === methodFilter);
    }

    result.sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return result;
  }, [endpoints, methodFilter, sortBy, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-primary" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-primary" />
    );
  };

  const latencyChartData = useMemo(() => {
    if (!endpointLatency) return [];
    return endpointLatency.map((l, i) => ({
      name: l.bucket,
      value: l.count,
      fill: LATENCY_COLORS[i] || "#9ca3af",
    }));
  }, [endpointLatency]);

  return (
    <AuthLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Endpoints</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Per-endpoint performance metrics
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={timeRange}
              onValueChange={(v) => setTimeRange(v as TimeRange)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last Hour</SelectItem>
                <SelectItem value="6h">Last 6 Hours</SelectItem>
                <SelectItem value="24h">Last 24 Hours</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Endpoints Table */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                All Endpoints
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button className="flex items-center gap-1 hover:text-primary" onClick={() => toggleSort("method")}>
                          Method <SortIcon field="method" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 hover:text-primary" onClick={() => toggleSort("path")}>
                          Endpoint <SortIcon field="path" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button className="flex items-center gap-1 hover:text-primary ml-auto" onClick={() => toggleSort("totalRequests")}>
                          Requests <SortIcon field="totalRequests" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button className="flex items-center gap-1 hover:text-primary ml-auto" onClick={() => toggleSort("avgLatencyMs")}>
                          Avg Latency <SortIcon field="avgLatencyMs" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">Success</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 10 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : filteredEndpoints.length > 0 ? (
                      filteredEndpoints.map((ep) => {
                        const successRate = ep.totalRequests > 0
                          ? ((ep.totalRequests - ep.failedRequests) / ep.totalRequests) * 100
                          : 0;
                        const failRate = ep.totalRequests > 0
                          ? (ep.failedRequests / ep.totalRequests) * 100
                          : 0;
                        return (
                          <TableRow
                            key={`${ep.path}-${ep.method}`}
                            className={`cursor-pointer ${selectedEndpoint === ep.path ? "bg-primary/5" : ""}`}
                            onClick={() => setSelectedEndpoint(ep.path)}
                          >
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] font-mono ${METHOD_COLORS[ep.method] ?? "bg-muted"}`}>
                                {ep.method}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[300px]">
                              <span className="text-sm font-medium truncate block" title={ep.path}>
                                {ep.path}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {ep.totalRequests.toLocaleString()}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm ${getLatencyColorClass(ep.avgLatencyMs)}`}>
                              {ep.avgLatencyMs.toFixed(0)}ms
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {successRate >= 95 ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                                )}
                                <span className={`text-xs font-medium ${failRate > 5 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                  {successRate.toFixed(1)}%
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                          <p>No endpoints found</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Endpoint Detail Panel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                {selectedEndpoint ? "Endpoint Detail" : "Select an Endpoint"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedEndpoint ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">Endpoint</p>
                    <p className="text-sm font-mono font-medium break-all">{selectedEndpoint}</p>
                  </div>

                  {(() => {
                    const ep = filteredEndpoints.find((e) => e.path === selectedEndpoint);
                    if (!ep) return null;
                    const successRate = ep.totalRequests > 0
                      ? ((ep.totalRequests - ep.failedRequests) / ep.totalRequests) * 100
                      : 0;
                    return (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-muted p-2.5">
                          <p className="text-[10px] text-muted-foreground">Total Requests</p>
                          <p className="text-lg font-semibold">{ep.totalRequests.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg bg-muted p-2.5">
                          <p className="text-[10px] text-muted-foreground">Success Rate</p>
                          <p className={`text-lg font-semibold ${successRate >= 95 ? "text-emerald-600" : "text-amber-600"}`}>
                            {successRate.toFixed(1)}%
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted p-2.5">
                          <p className="text-[10px] text-muted-foreground">Avg Latency</p>
                          <p className={`text-lg font-semibold ${getLatencyColorClass(ep.avgLatencyMs)}`}>
                            {ep.avgLatencyMs.toFixed(0)}ms
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted p-2.5">
                          <p className="text-[10px] text-muted-foreground">Max Latency</p>
                          <p className="text-lg font-semibold">{ep.maxLatencyMs}ms</p>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <p className="text-sm font-medium mb-2">Latency Distribution</p>
                    {latencyChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={latencyChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="name" fontSize={9} stroke="hsl(var(--muted-foreground))" />
                          <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "11px",
                            }}
                          />
                          <Bar dataKey="value" name="Requests" radius={[3, 3, 0, 0]}>
                            {latencyChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
                        No latency data
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mb-3 text-muted-foreground/50" />
                  <p className="text-sm font-medium">Select an endpoint</p>
                  <p className="text-xs mt-1">Click on any endpoint row to view details</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthLayout>
  );
}
