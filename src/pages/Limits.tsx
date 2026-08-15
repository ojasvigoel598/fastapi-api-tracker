/**
 * Limits & Rate-Limiting Page
 *
 * Configure per-API usage limits (daily/monthly/cost), thresholds, email
 * alerts, and rate limiting. Shows current usage vs limits for the selected
 * period and a history of usage alerts.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Gauge,
  ShieldAlert,
  Mail,
  Settings2,
  Trash2,
  BellRing,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
} from "lucide-react";

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  POST: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PUT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DELETE: "bg-red-500/10 text-red-700 dark:text-red-400",
  PATCH: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; text: string; bg: string; bar: string }
> = {
  ok: {
    label: "OK",
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  warning: {
    label: "Warning",
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  critical: {
    label: "Critical",
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    bar: "bg-orange-500",
  },
  limit: {
    label: "Limit reached",
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10 text-red-700 dark:text-red-400",
    bar: "bg-red-500",
  },
};

const SEVERITY_ICONS: Record<string, React.ElementType> = {
  warning: AlertTriangle,
  critical: XCircle,
  limit: ShieldAlert,
  reset: Info,
};

const SEVERITY_COLORS: Record<string, string> = {
  warning: "text-amber-500",
  critical: "text-orange-500",
  limit: "text-red-500",
  reset: "text-blue-500",
};

type UsageRow = {
  key: string;
  endpoint: string;
  method: string;
  configured: boolean;
  limitId?: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  costLimit: number | null;
  warningThreshold: number;
  criticalThreshold: number;
  emailAlerts: boolean;
  rateLimiting: boolean;
  status: "ok" | "warning" | "critical" | "limit";
  daily: { used: number; limit: number | null; percentage: number; remaining: number | null };
  monthly: { used: number; limit: number | null; percentage: number; remaining: number | null };
  cost: { used: number; limit: number | null; percentage: number };
};

function fmtLimit(limit: number | null): string {
  return limit === null ? "∞" : limit.toLocaleString();
}

function UsageBar({
  used,
  limit,
  status,
}: {
  used: number;
  limit: number | null;
  status: string;
}) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.ok;
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="w-full min-w-[120px]">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-mono text-foreground">
          {used.toLocaleString()} / {fmtLimit(limit)}
        </span>
        <span className={`font-medium ${cfg.text}`}>
          {limit && limit > 0 ? `${((used / limit) * 100).toFixed(0)}%` : "—"}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${cfg.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function LimitsPage() {
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [editing, setEditing] = useState<{
    endpoint: string;
    method: string;
    row?: UsageRow;
  } | null>(null);

  const utils = trpc.useUtils();

  const { data: limits, isLoading: limitsLoading } = trpc.limits.list.useQuery();
  const { data: endpoints } = trpc.monitoring.endpoints.useQuery({
    timeRange: "30d",
  });
  const { data: usageAlerts } = trpc.limits.alerts.useQuery();

  const saveMutation = trpc.limits.save.useMutation({
    onSuccess: () => {
      utils.limits.list.invalidate();
      utils.limits.alerts.invalidate();
      setEditing(null);
    },
  });

  const removeMutation = trpc.limits.remove.useMutation({
    onSuccess: () => {
      utils.limits.list.invalidate();
      setEditing(null);
    },
  });

  const rows = useMemo<UsageRow[]>(() => {
    const limitByKey = new Map(
      (limits ?? []).map((l) => [`${l.method} ${l.endpoint}`, l]),
    );
    const merged = new Map<string, UsageRow>();

    // Start from tracked endpoints so unconfigured APIs are also visible.
    for (const ep of endpoints ?? []) {
      const key = `${ep.method} ${ep.path}`;
      const l = limitByKey.get(key);
      merged.set(key, {
        key,
        endpoint: ep.path,
        method: ep.method,
        configured: Boolean(l),
        limitId: l?.id,
        dailyLimit: l?.dailyLimit ?? null,
        monthlyLimit: l?.monthlyLimit ?? null,
        costLimit: l?.costLimit ?? null,
        warningThreshold: l?.warningThreshold ?? 80,
        criticalThreshold: l?.criticalThreshold ?? 95,
        emailAlerts: l?.emailAlerts ?? false,
        rateLimiting: l?.rateLimiting ?? false,
        status: l?.status ?? "ok",
        daily: l?.daily ?? { used: 0, limit: null, percentage: 0, remaining: null },
        monthly: l?.monthly ?? { used: 0, limit: null, percentage: 0, remaining: null },
        cost: l?.cost ?? { used: 0, limit: null, percentage: 0 },
      });
    }

    // Include configured limits even if the endpoint has no recent traffic.
    for (const l of limits ?? []) {
      const key = `${l.method} ${l.endpoint}`;
      if (merged.has(key)) continue;
      merged.set(key, {
        key,
        endpoint: l.endpoint,
        method: l.method,
        configured: true,
        limitId: l.id,
        dailyLimit: l.dailyLimit,
        monthlyLimit: l.monthlyLimit,
        costLimit: l.costLimit,
        warningThreshold: l.warningThreshold,
        criticalThreshold: l.criticalThreshold,
        emailAlerts: l.emailAlerts,
        rateLimiting: l.rateLimiting,
        status: l.status,
        daily: l.daily,
        monthly: l.monthly,
        cost: l.cost,
      });
    }

    return [...merged.values()].sort((a, b) => {
      const aUsed = period === "daily" ? a.daily.used : a.monthly.used;
      const bUsed = period === "daily" ? b.daily.used : b.monthly.used;
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      return bUsed - aUsed;
    });
  }, [limits, endpoints, period]);

  const configuredCount = (limits ?? []).length;
  const rateLimitedCount = (limits ?? []).filter((l) => l.rateLimiting).length;
  const activeAlertCount = (usageAlerts ?? []).filter(
    (a) => a.severity !== "reset",
  ).length;

  const editingRow = editing?.row;
  const currentPeriodUsage = editingRow
    ? period === "daily"
      ? editingRow.daily
      : editingRow.monthly
    : null;

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Limits & Rate Limiting</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure usage limits, thresholds, and rate limiting per API endpoint
            </p>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as "daily" | "monthly")}>
            <TabsList>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Configured APIs</p>
                  <p className="text-2xl font-bold mt-1">{configuredCount}</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Gauge className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Rate limiting enabled</p>
                  <p className="text-2xl font-bold mt-1">{rateLimitedCount}</p>
                </div>
                <div className="rounded-lg bg-amber-500/10 p-2.5">
                  <ShieldAlert className="h-5 w-5 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Usage alerts</p>
                  <p className="text-2xl font-bold mt-1">{activeAlertCount}</p>
                </div>
                <div className="rounded-lg bg-red-500/10 p-2.5">
                  <BellRing className="h-5 w-5 text-red-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Limits table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              API Limits
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>API</TableHead>
                    <TableHead className="min-w-[160px]">
                      {period === "daily" ? "Daily usage" : "Monthly usage"}
                    </TableHead>
                    <TableHead className="min-w-[120px]">Status</TableHead>
                    <TableHead>Rate limiting</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limitsLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : rows.length > 0 ? (
                    rows.map((row) => {
                      const usage = period === "daily" ? row.daily : row.monthly;
                      const cfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.ok;
                      return (
                        <TableRow
                          key={row.key}
                          className="cursor-pointer"
                          onClick={() => setEditing({ endpoint: row.endpoint, method: row.method, row })}
                        >
                          <TableCell className="max-w-[280px]">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-mono ${METHOD_COLORS[row.method] ?? "bg-muted"}`}
                              >
                                {row.method}
                              </Badge>
                              <span className="text-sm font-medium truncate" title={row.endpoint}>
                                {row.endpoint}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <UsageBar used={usage.used} limit={usage.limit} status={row.status} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${cfg.bg}`}>
                              {row.configured ? cfg.label : "No limit"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {row.rateLimiting ? (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                Enforced
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Off</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.emailAlerts ? (
                              <Mail className="h-4 w-4 text-primary" />
                            ) : (
                              <span className="text-xs text-muted-foreground">Off</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditing({ endpoint: row.endpoint, method: row.method, row })}
                            >
                              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                              Configure
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        No endpoints tracked yet. Submit a request to{" "}
                        <code className="font-mono text-xs">POST /api/ingest</code> to start.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Usage alerts history */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <BellRing className="h-4 w-4 text-primary" />
              Usage Alert History ({(usageAlerts ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(usageAlerts ?? []).length > 0 ? (
              <div className="space-y-2">
                {(usageAlerts ?? []).slice(0, 20).map((a) => {
                  const Icon = SEVERITY_ICONS[a.severity] ?? Info;
                  return (
                    <div
                      key={a.id}
                      className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                    >
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${SEVERITY_COLORS[a.severity] ?? "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{a.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {a.period} · {a.method} {a.endpoint}
                          {a.emailed ? " · emailed" : ""} · {a.createdAt.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mb-3 text-emerald-500" />
                <p className="text-sm font-medium">No usage alerts yet</p>
                <p className="text-xs mt-1">
                  Alerts appear when an API crosses its warning, critical, or hard limit.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <LimitEditorDialog
        open={!!editing}
        endpoint={editing?.endpoint ?? ""}
        method={editing?.method ?? ""}
        row={editingRow}
        period={period}
        currentUsage={currentPeriodUsage}
        saving={saveMutation.isPending}
        onClose={() => setEditing(null)}
        onSave={(config) =>
          editing &&
          saveMutation.mutate({
            endpoint: editing.endpoint,
            method: editing.method,
            config,
          })
        }
        onRemove={
          editing
            ? () =>
                removeMutation.mutate({
                  endpoint: editing.endpoint,
                  method: editing.method,
                })
            : undefined
        }
      />
    </AuthLayout>
  );
}

function LimitEditorDialog({
  open,
  endpoint,
  method,
  row,
  period,
  currentUsage,
  saving,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  endpoint: string;
  method: string;
  row?: UsageRow;
  period: "daily" | "monthly";
  currentUsage: { used: number; limit: number | null } | null;
  saving: boolean;
  onClose: () => void;
  onSave: (config: {
    dailyLimit: number | null;
    monthlyLimit: number | null;
    costLimit: number | null;
    warningThreshold: number;
    criticalThreshold: number;
    emailAlerts: boolean;
    rateLimiting: boolean;
  }) => void;
  onRemove?: () => void;
}) {
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  const [cost, setCost] = useState("");
  const [warning, setWarning] = useState("80");
  const [critical, setCritical] = useState("95");
  const [email, setEmail] = useState(false);
  const [rateLimit, setRateLimit] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Sync form fields when a new row opens.
  if (open && !initialized) {
    setDaily(row?.dailyLimit == null ? "" : String(row.dailyLimit));
    setMonthly(row?.monthlyLimit == null ? "" : String(row.monthlyLimit));
    setCost(row?.costLimit == null ? "" : String(row.costLimit));
    setWarning(String(row?.warningThreshold ?? 80));
    setCritical(String(row?.criticalThreshold ?? 95));
    setEmail(row?.emailAlerts ?? false);
    setRateLimit(row?.rateLimiting ?? false);
    setInitialized(true);
  }

  function parseNum(v: string): number | null {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function handleSave() {
    onSave({
      dailyLimit: parseNum(daily),
      monthlyLimit: parseNum(monthly),
      costLimit: parseNum(cost),
      warningThreshold: Number(warning) || 80,
      criticalThreshold: Number(critical) || 95,
      emailAlerts: email,
      rateLimiting: rateLimit,
    });
  }

  function handleClose() {
    setInitialized(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configure limit</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {method} {endpoint}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {currentUsage && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Current {period} usage: </span>
              <span className="font-medium">
                {currentUsage.used.toLocaleString()}
                {currentUsage.limit !== null ? ` / ${currentUsage.limit.toLocaleString()}` : ""}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="daily-limit">Daily request limit</Label>
              <Input
                id="daily-limit"
                type="number"
                min="0"
                placeholder="Unlimited"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthly-limit">Monthly request limit</Label>
              <Input
                id="monthly-limit"
                type="number"
                min="0"
                placeholder="Unlimited"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cost-limit">Monthly cost limit</Label>
            <Input
              id="cost-limit"
              type="number"
              min="0"
              step="0.01"
              placeholder="Unlimited"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="warning-threshold">Warning threshold (%)</Label>
              <Input
                id="warning-threshold"
                type="number"
                min="1"
                max="100"
                value={warning}
                onChange={(e) => setWarning(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="critical-threshold">Critical threshold (%)</Label>
              <Input
                id="critical-threshold"
                type="number"
                min="1"
                max="100"
                value={critical}
                onChange={(e) => setCritical(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Email alerts</p>
                <p className="text-xs text-muted-foreground">Notify when thresholds are crossed</p>
              </div>
              <Switch checked={email} onCheckedChange={setEmail} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Rate limiting</p>
                <p className="text-xs text-muted-foreground">
                  Reject requests (HTTP 429) at the hard limit
                </p>
              </div>
              <Switch checked={rateLimit} onCheckedChange={setRateLimit} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onRemove ? (
            <Button variant="ghost" size="sm" onClick={onRemove} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
