/**
 * FailureDetailDialog — explains a single failed API request in plain
 * language, backed by the real tracking record (status code, error message,
 * request headers, latency, source, timestamp).
 */

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Globe,
  Lightbulb,
  MonitorSmartphone,
  Server,
  Wrench,
} from "lucide-react";
import {
  failureInfo,
  type FailureRequest,
} from "@/lib/failures";

function statusBadgeClass(code: number): string {
  if (code >= 400 && code < 500)
    return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 break-all text-sm">{children}</div>
    </div>
  );
}

function headerLines(headers: Record<string, string> | null): [string, string][] {
  if (!headers) return [];
  return Object.entries(headers).slice(0, 12);
}

export function FailureDetailDialog({
  request,
  open,
  onOpenChange,
}: {
  request: FailureRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const info = request ? failureInfo(request.statusCode) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Request failed
            {request && (
              <Badge
                variant="outline"
                className={`text-[10px] font-mono ${statusBadgeClass(request.statusCode)}`}
              >
                {request.statusCode}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {request ? (
              <>
                <span className="font-medium text-foreground">
                  {info?.title}
                </span>
                {" — "}
                <span className="font-mono">
                  {request.method} {request.endpoint}
                </span>
              </>
            ) : (
              "Failure details"
            )}
          </DialogDescription>
        </DialogHeader>

        {request && info && (
          <div className="space-y-4">
            {/* What happened */}
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                <Server className="h-4 w-4" />
                What happened
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {info.explanation}
              </p>
            </div>

            {/* Error message */}
            {request.errorMessage && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Error returned by the API
                </p>
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2.5 font-mono text-xs">
                  {request.errorMessage}
                </pre>
              </div>
            )}

            {/* Facts grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Fact label="Endpoint">
                <span className="font-mono text-xs">{request.endpoint}</span>
              </Fact>
              <Fact label="Method">
                <span className="font-mono text-xs">{request.method}</span>
              </Fact>
              <Fact label="Status code">
                <span className="font-mono text-xs">{request.statusCode}</span>
              </Fact>
              <Fact label="Timestamp">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {request.createdAt.toLocaleString()}
                </span>
              </Fact>
              <Fact label="Response time">
                <span className="font-mono text-xs">
                  {request.latencyMs}ms
                </span>
              </Fact>
              <Fact label="Response size">
                <span className="font-mono text-xs">
                  {request.responseSize != null
                    ? `${request.responseSize.toLocaleString()} bytes`
                    : "—"}
                </span>
              </Fact>
              <Fact label="Source IP">
                <span className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs">
                    {request.sourceIp ?? "—"}
                  </span>
                </span>
              </Fact>
              <Fact label="User agent">
                <span className="flex items-center gap-1.5">
                  <MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs">
                    {request.userAgent ?? "—"}
                  </span>
                </span>
              </Fact>
            </div>

            {/* Request headers */}
            {headerLines(request.requestHeaders).length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Request headers
                </p>
                <div className="overflow-hidden rounded-lg border">
                  {headerLines(request.requestHeaders).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex gap-3 px-3 py-1.5 text-xs odd:bg-muted/40"
                    >
                      <span className="shrink-0 font-mono font-medium">
                        {key}
                      </span>
                      <span className="break-all font-mono text-muted-foreground">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Next steps */}
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400">
                <Lightbulb className="h-4 w-4" />
                What to do next
              </p>
              <p className="mt-1.5 flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{info.suggestion}</span>
              </p>
              <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowRight className="h-3.5 w-3.5" />
                The full trace is available in Request Logs.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
