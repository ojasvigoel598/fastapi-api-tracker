/**
 * Alerts Page
 *
 * Alert management with:
 * - Filterable list of all alerts (active/acknowledged)
 * - Severity-based filtering
 * - Acknowledge alerts
 * - Alert details with metadata
 * - Statistics summary
 */

import { useState } from "react";
import { trpc } from "@/providers/trpc";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  XCircle,
  Info,
  CheckCircle2,
  Clock,
  Filter,
  Bell,
  TrendingUp,
  Zap,
  Server,
  Globe,
} from "lucide-react";


type SeverityFilter = "all" | "critical" | "warning" | "info";
type StatusFilter = "all" | "active" | "acknowledged";

const SEVERITY_CONFIG = {
  critical: {
    icon: XCircle,
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-700 dark:text-red-400",
    iconColor: "text-red-500",
    badge: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-700 dark:text-amber-400",
    iconColor: "text-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
  info: {
    icon: Info,
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-700 dark:text-blue-400",
    iconColor: "text-blue-500",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  },
};

const ALERT_TYPE_ICONS: Record<string, React.ElementType> = {
  failure_rate_spike: TrendingUp,
  latency_spike: Zap,
  error_rate_threshold: Server,
  endpoint_down: Globe,
};

export default function AlertsPage() {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const utils = trpc.useUtils();

  const { data: allAlerts, isLoading } = trpc.monitoring.alerts.useQuery({
    acknowledged: statusFilter === "acknowledged" ? true : statusFilter === "active" ? false : undefined,
    severity: severityFilter === "all" ? undefined : severityFilter,
  });

  const acknowledgeMutation = trpc.monitoring.acknowledgeAlert.useMutation({
    onSuccess: () => {
      utils.monitoring.alerts.invalidate();
    },
  });

  const alerts = allAlerts ?? [];
  const activeCount = alerts.filter((a) => !a.acknowledged).length;
  const criticalCount = alerts.filter((a) => a.severity === "critical" && !a.acknowledged).length;
  const warningCount = alerts.filter((a) => a.severity === "warning" && !a.acknowledged).length;

  return (
    <AuthLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {activeCount} active alerts, {criticalCount} critical
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as SeverityFilter)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Alerts</p>
                  <p className="text-2xl font-bold mt-1">{activeCount}</p>
                </div>
                <div className="rounded-lg bg-amber-500/10 p-2.5">
                  <Bell className="h-5 w-5 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Critical</p>
                  <p className="text-2xl font-bold mt-1 text-red-600">{criticalCount}</p>
                </div>
                <div className="rounded-lg bg-red-500/10 p-2.5">
                  <XCircle className="h-5 w-5 text-red-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Warning</p>
                  <p className="text-2xl font-bold mt-1 text-amber-600">{warningCount}</p>
                </div>
                <div className="rounded-lg bg-amber-500/10 p-2.5">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alerts List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              All Alerts ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.map((alert) => {
                  const config = SEVERITY_CONFIG[alert.severity];
                  const Icon = config.icon;
                  const TypeIcon = ALERT_TYPE_ICONS[alert.type] ?? Bell;

                  return (
                    <div
                      key={alert.id}
                      className={`rounded-lg border p-4 transition-colors ${
                        alert.acknowledged ? "bg-muted/30 opacity-60" : config.bg + " " + config.border
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {alert.acknowledged ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                          ) : (
                            <Icon className={`h-5 w-5 ${config.iconColor}`} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${alert.acknowledged ? "" : config.badge}`}
                            >
                              {alert.severity}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              <TypeIcon className="h-2.5 w-2.5 mr-1" />
                              {alert.type.replace(/_/g, " ")}
                            </Badge>
                            {alert.endpoint && (
                              <Badge variant="outline" className="text-[10px] font-mono">
                                {alert.endpoint}
                              </Badge>
                            )}
                            {alert.acknowledged ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              >
                                acknowledged
                              </Badge>
                            ) : null}
                          </div>
                          <p className={`text-sm font-medium ${alert.acknowledged ? "text-muted-foreground line-through" : ""}`}>
                            {alert.message}
                          </p>
                          {alert.details && typeof alert.details === "object" && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                              {Object.entries(alert.details).map(([key, value]) => (
                                <span key={key} className="font-mono">
                                  {key}: {String(value)}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {alert.createdAt.toLocaleString()}
                          </div>
                        </div>
                        {!alert.acknowledged && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              acknowledgeMutation.mutate({ alertId: alert.id })
                            }
                            disabled={acknowledgeMutation.isPending}
                            className="shrink-0"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Acknowledge
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
                <p className="text-lg font-medium">All Clear</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No alerts match the current filters
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AuthLayout>
  );
}
