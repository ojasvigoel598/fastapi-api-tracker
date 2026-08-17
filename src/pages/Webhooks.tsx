/**
 * Webhooks Page
 *
 * Manage the API keys that authenticate the real-time telemetry webhook
 * (`POST /api/webhook/ingest`). External API gateways push request
 * telemetry with `Authorization: Bearer <key>` and it lands in the same
 * monitoring queries and usage limits as the in-app ingest channel.
 */

import { useState } from "react";
import { trpc } from "@/providers/trpc";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  KeyRound,
  Copy,
  Check,
  Trash2,
  Plus,
  Webhook,
  ShieldCheck,
  RotateCcw,
  History,
} from "lucide-react";

const REFRESH_MS = 10_000;

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString();
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for environments where the Clipboard API is unavailable.
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
  return Promise.resolve();
}

export default function WebhooksPage() {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: keys, isLoading } = trpc.webhooks.listKeys.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
  });

  const createMutation = trpc.webhooks.createKey.useMutation({
    onSuccess: (result) => {
      setFreshKey(result.key);
      setName("");
      utils.webhooks.listKeys.invalidate();
    },
  });

  const revokeMutation = trpc.webhooks.revokeKey.useMutation({
    onSuccess: () => {
      utils.webhooks.listKeys.invalidate();
    },
  });

  const { data: deliveries } = trpc.webhooks.listDeliveries.useQuery(
    undefined,
    { refetchInterval: REFRESH_MS },
  );

  const [replayResult, setReplayResult] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<number | null>(null);

  const replayMutation = trpc.webhooks.replayDelivery.useMutation({
    onSuccess: (result, { id }) => {
      setReplayResult({
        id,
        text: result.blocked
          ? `Replayed — blocked by rate limit (0 recorded)`
          : `Replayed ${result.received} event${result.received === 1 ? "" : "s"} ✓`,
      });
      utils.webhooks.listDeliveries.invalidate();
      setTimeout(() => setReplayResult(null), 4000);
    },
    onError: (err, { id }) => {
      setReplayResult({ id, text: `Replay failed: ${err.message}` });
      setTimeout(() => setReplayResult(null), 6000);
    },
  });

  async function handleCopy(text: string, id: string) {
    await copyText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  async function handleCopyCurl(deliveryId: number) {
    await copyText(replayCurl(deliveryId));
    setCopiedCurl(deliveryId);
    setTimeout(() => setCopiedCurl(null), 1500);
  }

  const endpoint = `${window.location.origin}/api/webhook/ingest`;

  function replayCurl(id: number): string {
    return `curl -X POST ${window.location.origin}/api/webhook/replay/${id} \\
  -H "Authorization: Bearer apk_..."`;
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stream real-time request telemetry from your API gateway
          </p>
        </div>

        {/* Create key */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Create API key
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="key-name">Key name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g. Production gateway"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) {
                      createMutation.mutate({ name: name.trim() });
                    }
                  }}
                />
              </div>
              <div className="sm:pt-7">
                <Button
                  onClick={() => createMutation.mutate({ name: name.trim() })}
                  disabled={!name.trim() || createMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  {createMutation.isPending ? "Creating…" : "Create key"}
                </Button>
              </div>
            </div>

            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {createMutation.error.message}
              </p>
            )}

            {freshKey && (
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      Key created — copy it now, it won&apos;t be shown again
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Only the key&apos;s fingerprint is stored, so it cannot be
                      recovered later.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
                    {freshKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => handleCopy(freshKey, "fresh")}
                  >
                    {copied === "fresh" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">{copied === "fresh" ? "Copied" : "Copy"}</span>
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-lg bg-muted p-4 space-y-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" />
                Send telemetry
              </p>
              <pre className="overflow-x-auto rounded-md bg-background p-3 font-mono text-[11px] leading-relaxed">
{`curl -X POST ${endpoint} \\
  -H "Authorization: Bearer apk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "endpoint": "/api/v1/users",
    "method": "GET",
    "statusCode": 200,
    "latencyMs": 42,
    "responseSize": 512
  }'`}
              </pre>
              <p className="text-xs text-muted-foreground">
                Single events or a batch of up to 500 via{" "}
                <code className="font-mono text-[11px]">{"{ \"events\": [...] }"}</code>.
                Rate limits and usage limits apply exactly as with{" "}
                <code className="font-mono text-[11px]">POST /api/ingest</code>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Key list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              API keys ({(keys ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 5 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (keys ?? []).length > 0 ? (
                    (keys ?? []).map((key) => (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">{key.name}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">
                            ••••••••••{key.keyHint}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(key.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(key.lastUsedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => revokeMutation.mutate({ id: key.id })}
                            disabled={revokeMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        No API keys yet. Create one above to start streaming telemetry.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Recent deliveries (replay) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Recent deliveries ({(deliveries ?? []).length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Re-fire a past webhook batch without re-sending it from your
              gateway. Replays go through the same rate limits, so an
              over-limit batch is blocked again.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(deliveries ?? []).length > 0 ? (
                    (deliveries ?? []).map((delivery) => (
                      <TableRow key={delivery.id}>
                        <TableCell className="font-medium">
                          {delivery.keyName ?? "—"}
                        </TableCell>
                        <TableCell>
                          {delivery.outcome === "received" ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              received
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                              blocked
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {delivery.eventCount}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(delivery.receivedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Copy the REST replay curl command"
                                onClick={() => handleCopyCurl(delivery.id)}
                              >
                                {copiedCurl === delivery.id ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                <span className="ml-1.5 text-xs">
                                  {copiedCurl === delivery.id ? "Copied" : "curl"}
                                </span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  replayMutation.mutate({ id: delivery.id })
                                }
                                disabled={replayMutation.isPending}
                              >
                                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                                Replay
                              </Button>
                            </div>
                            {replayResult?.id === delivery.id && (
                              <span
                                className={`text-xs ${
                                  replayResult.text.includes("failed")
                                    ? "text-destructive"
                                    : replayResult.text.includes("blocked")
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {replayResult.text}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        No webhook deliveries yet. Send a batch above and it
                        appears here for replay.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthLayout>
  );
}
