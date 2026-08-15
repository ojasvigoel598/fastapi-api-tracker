/**
 * Requests Log Page
 *
 * Full-featured request log viewer with:
 * - Advanced filtering (endpoint, method, status code, date range, search)
 * - Sorting by any column
 * - Pagination
 * - CSV/JSON export
 * - Responsive table with status indicators
 */

import { useState, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  FileJson,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import type { TimeRange } from "../../api/queries/time-range";
import TimeRangePicker from "@/components/TimeRangePicker";
import { toTimeRangeQuery } from "@/lib/time-range";

type SortField = "createdAt" | "latencyMs" | "statusCode" | "endpoint" | "method";
type SortOrder = "asc" | "desc";

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  POST: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  PUT: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  DELETE: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  PATCH: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
};

function getStatusBadgeClass(code: number): string {
  if (code >= 200 && code < 300) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  if (code >= 300 && code < 400) return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
  if (code >= 400 && code < 500) return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
}

function getLatencyColor(latency: number): string {
  if (latency < 100) return "text-emerald-600 dark:text-emerald-400";
  if (latency < 300) return "text-amber-600 dark:text-amber-400";
  if (latency < 1000) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function SortIcon({
  field,
  sortBy,
  sortOrder,
}: {
  field: SortField;
  sortBy: SortField;
  sortOrder: SortOrder;
}) {
  if (sortBy !== field)
    return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
  return sortOrder === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-primary" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-primary" />
  );
}

export default function RequestsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [search, setSearch] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const rangeQuery = toTimeRangeQuery(timeRange, startDate, endDate);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortBy === field) {
        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(field);
        setSortOrder("desc");
      }
      setPage(1);
    },
    [sortBy]
  );

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.monitoring.requests.useQuery({
    filters: {
      search: search || undefined,
      endpoint: endpointFilter || undefined,
      method: methodFilter || undefined,
      statusCode: statusFilter ? parseInt(statusFilter) : undefined,
      ...rangeQuery,
    },
    pagination: { page, pageSize, sortBy, sortOrder },
  });

  const { data: allEndpoints } = trpc.monitoring.endpoints.useQuery({
    ...rangeQuery,
    limit: 100,
  });

  const handleExport = useCallback(
    async (format: "csv" | "json") => {
      const result = await utils.monitoring.export.fetch({
        format,
        filters: {
          search: search || undefined,
          endpoint: endpointFilter || undefined,
          method: methodFilter || undefined,
          statusCode: statusFilter ? parseInt(statusFilter) : undefined,
          ...rangeQuery,
        },
      });

      const blob = new Blob([result], {
        type: format === "csv" ? "text/csv" : "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `api-requests-${new Date().toISOString().split("T")[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
    [utils, search, endpointFilter, methodFilter, statusFilter, rangeQuery]
  );

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <AuthLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Request Logs</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {total.toLocaleString()} total requests
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 mr-1.5" />
              Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("csv")}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("json")}
            >
              <FileJson className="h-4 w-4 mr-1.5" />
              JSON
            </Button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    className="pl-9"
                  />
                </div>
                <Select
                  value={endpointFilter}
                  onValueChange={(v) => {                      setEndpointFilter(v === "all" ? "" : v);
                      setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Endpoint" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Endpoints</SelectItem>
                    {(allEndpoints ?? []).map((ep) => (
                      <SelectItem key={ep.path} value={ep.path}>
                        {ep.method} {ep.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={methodFilter}
                  onValueChange={(v) => {
                    setMethodFilter(v === "all" ? "" : v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
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
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v === "all" ? "" : v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="200">200 OK</SelectItem>
                    <SelectItem value="201">201 Created</SelectItem>
                    <SelectItem value="301">301 Redirect</SelectItem>
                    <SelectItem value="400">400 Bad Request</SelectItem>
                    <SelectItem value="401">401 Unauthorized</SelectItem>
                    <SelectItem value="403">403 Forbidden</SelectItem>
                    <SelectItem value="404">404 Not Found</SelectItem>
                    <SelectItem value="500">500 Server Error</SelectItem>
                    <SelectItem value="503">503 Unavailable</SelectItem>
                  </SelectContent>
                </Select>
                <TimeRangePicker
                  value={timeRange}
                  onChange={(value) => {
                    setTimeRange(value);
                    setPage(1);
                  }}
                  startDate={startDate}
                  endDate={endDate}
                  onStartDateChange={(value) => {
                    setStartDate(value);
                    setPage(1);
                  }}
                  onEndDateChange={(value) => {
                    setEndDate(value);
                    setPage(1);
                  }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">
                      <button
                        className="flex items-center gap-1 hover:text-primary"
                        onClick={() => toggleSort("statusCode")}
                      >
                        Status
                        <SortIcon field="statusCode" sortBy={sortBy} sortOrder={sortOrder} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className="flex items-center gap-1 hover:text-primary"
                        onClick={() => toggleSort("method")}
                      >
                        Method
                        <SortIcon field="method" sortBy={sortBy} sortOrder={sortOrder} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className="flex items-center gap-1 hover:text-primary"
                        onClick={() => toggleSort("endpoint")}
                      >
                        Endpoint
                        <SortIcon field="endpoint" sortBy={sortBy} sortOrder={sortOrder} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className="flex items-center gap-1 hover:text-primary"
                        onClick={() => toggleSort("latencyMs")}
                      >
                        Latency
                        <SortIcon field="latencyMs" sortBy={sortBy} sortOrder={sortOrder} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className="flex items-center gap-1 hover:text-primary"
                        onClick={() => toggleSort("createdAt")}
                      >
                        Timestamp
                        <SortIcon field="createdAt" sortBy={sortBy} sortOrder={sortOrder} />
                      </button>
                    </TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: pageSize }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : items.length > 0 ? (
                    items.map((req) => (
                      <TableRow key={req.id} className="group">
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-mono ${getStatusBadgeClass(req.statusCode)}`}
                          >
                            {req.statusCode}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-mono ${METHOD_COLORS[req.method] ?? "bg-muted"}`}
                          >
                            {req.method}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <span
                            className="text-sm truncate block"
                            title={req.endpoint}
                          >
                            {req.endpoint}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`text-sm font-mono ${getLatencyColor(req.latencyMs)}`}
                          >
                            {req.latencyMs}ms
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {req.createdAt.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Search className="h-3.5 w-3.5" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-lg">
                              <DialogHeader>
                                <DialogTitle className="text-base flex items-center gap-2">
                                  Request Details
                                  <Badge
                                    variant="outline"
                                    className={getStatusBadgeClass(
                                      req.statusCode
                                    )}
                                  >
                                    {req.statusCode}
                                  </Badge>
                                </DialogTitle>
                              </DialogHeader>
                              <div className="space-y-3 text-sm">
                                <div className="grid grid-cols-3 gap-2">
                                  <span className="text-muted-foreground">
                                    Endpoint
                                  </span>
                                  <span className="col-span-2 font-mono text-xs break-all">
                                    {req.endpoint}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <span className="text-muted-foreground">
                                    Method
                                  </span>
                                  <span className="col-span-2">
                                    <Badge
                                      variant="outline"
                                      className={
                                        METHOD_COLORS[req.method] ?? ""
                                      }
                                    >
                                      {req.method}
                                    </Badge>
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <span className="text-muted-foreground">
                                    Latency
                                  </span>
                                  <span
                                    className={`col-span-2 font-mono ${getLatencyColor(req.latencyMs)}`}
                                  >
                                    {req.latencyMs}ms
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <span className="text-muted-foreground">
                                    Response Size
                                  </span>
                                  <span className="col-span-2 font-mono">
                                    {req.responseSize
                                      ? `${req.responseSize.toLocaleString()} bytes`
                                      : "—"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <span className="text-muted-foreground">
                                    Source IP
                                  </span>
                                  <span className="col-span-2 font-mono">
                                    {req.sourceIp ?? "—"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <span className="text-muted-foreground">
                                    User Agent
                                  </span>
                                  <span className="col-span-2 text-xs break-all">
                                    {req.userAgent ?? "—"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <span className="text-muted-foreground">
                                    Timestamp
                                  </span>
                                  <span className="col-span-2">
                                    {req.createdAt.toLocaleString()}
                                  </span>
                                </div>
                                {req.errorMessage && (
                                  <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3 mt-3">
                                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-medium text-xs mb-1">
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                      Error
                                    </div>
                                    <p className="text-xs text-red-700 dark:text-red-300">
                                      {req.errorMessage}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-12 text-muted-foreground"
                      >
                        <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                        <p className="font-medium">No requests found</p>
                        <p className="text-xs mt-1">
                          Try adjusting your filters
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[100px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="25">25 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                {((page - 1) * pageSize + 1).toLocaleString()} -{" "}
                {Math.min(page * pageSize, total).toLocaleString()} of{" "}
                {total.toLocaleString()}
              </span>
            </div>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={
                      page === 1 ? "pointer-events-none opacity-50" : ""
                    }
                  />
                </PaginationItem>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <PaginationItem key={pageNum}>
                      <PaginationLink
                        isActive={page === pageNum}
                        onClick={() => setPage(pageNum)}
                      >
                        {pageNum}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
                {totalPages > 5 && page < totalPages - 2 && (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                    className={
                      page === totalPages
                        ? "pointer-events-none opacity-50"
                        : ""
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
