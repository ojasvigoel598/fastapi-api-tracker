/**
 * In-memory demo data store.
 *
 * Activated automatically when `DATABASE_URL` is not configured (local demo
 * mode). Each user gets their own seeded dataset so multi-tenant isolation is
 * exercised even offline. Users are real scrypt-hashed email/password accounts
 * backed by memory; data resets on every restart.
 *
 * This store is never used when a real database is configured — the
 * MySQL/Drizzle path is untouched.
 */

import type {
  Alert,
  ApiRequest,
  InsertAlert,
  InsertApiRequest,
  User,
} from "@db/schema";
import type { NewUserInput } from "../queries/users";
import { hashPassword } from "../auth/password";
import { getDateBounds } from "../queries/time-range";
import type {
  AutomatedInsight,
  Endpoint,
  LatencyDistribution,
  MethodDistribution,
  OverviewMetrics,
  PaginationParams,
  RequestFilters,
  StatusCodeDistribution,
  TimeRange,
  TimeSeriesPoint,
} from "../queries/monitoring";

// ─── Seed dataset ─────────────────────────────────────────────────────

const ENDPOINT_DEFS: { path: string; methods: string[] }[] = [
  { path: "/api/v1/users", methods: ["GET", "POST", "PUT", "DELETE"] },
  { path: "/api/v1/users/:id/profile", methods: ["GET", "PUT"] },
  { path: "/api/v1/auth/login", methods: ["POST"] },
  { path: "/api/v1/auth/logout", methods: ["POST"] },
  { path: "/api/v1/auth/refresh", methods: ["POST"] },
  { path: "/api/v1/products", methods: ["GET", "POST", "PUT", "DELETE"] },
  { path: "/api/v1/products/:id", methods: ["GET", "PUT", "DELETE"] },
  { path: "/api/v1/products/search", methods: ["GET"] },
  { path: "/api/v1/orders", methods: ["GET", "POST"] },
  { path: "/api/v1/orders/:id", methods: ["GET", "PUT", "DELETE"] },
  { path: "/api/v1/orders/:id/status", methods: ["GET", "PATCH"] },
  { path: "/api/v1/payments/process", methods: ["POST"] },
  { path: "/api/v1/payments/:id/refund", methods: ["POST"] },
  { path: "/api/v1/notifications", methods: ["GET", "POST"] },
  { path: "/api/v1/notifications/:id/read", methods: ["PATCH"] },
  { path: "/api/v1/uploads", methods: ["POST"] },
  { path: "/api/v1/uploads/:id", methods: ["GET", "DELETE"] },
  { path: "/api/v1/reports/sales", methods: ["GET"] },
  { path: "/api/v1/reports/traffic", methods: ["GET"] },
  { path: "/api/v1/webhooks", methods: ["POST", "GET", "DELETE"] },
  { path: "/api/v1/health", methods: ["GET"] },
  { path: "/api/v1/metrics", methods: ["GET"] },
  { path: "/api/v1/settings", methods: ["GET", "PUT"] },
  { path: "/api/v1/search", methods: ["GET"] },
  { path: "/api/v1/export", methods: ["POST"] },
];

const ERROR_MESSAGES: Record<number, string> = {
  400: "Bad Request: Invalid parameters",
  401: "Unauthorized: Authentication required",
  403: "Forbidden: Insufficient permissions",
  404: "Not Found: Resource does not exist",
  422: "Unprocessable Entity: Validation failed",
  429: "Too Many Requests: Rate limit exceeded",
  500: "Internal Server Error",
  502: "Bad Gateway: Upstream service error",
  503: "Service Unavailable: Temporary outage",
  504: "Gateway Timeout: Request timed out",
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.0",
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.0",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.0",
  "PostmanRuntime/7.35.0",
  "curl/8.4.0",
  "python-requests/2.31.0",
  "Go-http-client/2.0",
  "Node.js/20.9.0",
  "okhttp/4.12.0",
  "API-Client/1.0.0",
];

const SOURCE_IPS = [
  "192.168.1.100",
  "192.168.1.101",
  "10.0.0.45",
  "172.16.0.12",
  "203.0.113.45",
  "198.51.100.22",
  "::1",
  "fe80::1",
  "10.10.10.10",
];

export const DEMO_USER = {
  email: "demo@example.com",
  password: "demo1234",
} as const;

let users: User[] = [];
let requests: ApiRequest[] = [];
let alerts: Alert[] = [];
let nextUserId = 1;
let nextRequestId = 1;
let nextAlertId = 1;
let seeded = false;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function genStatusCode(path: string): number {
  const weights =
    path === "/api/v1/health"
      ? [98, 1, 0, 1]
      : path.includes("auth/login")
        ? [90, 0, 8, 2]
        : path.includes("upload")
          ? [85, 0, 12, 3]
          : path.includes("payment")
            ? [88, 0, 8, 4]
            : path.includes("webhook")
              ? [80, 0, 15, 5]
              : [92, 3, 4, 1];

  const category = weightedPick(
    ["success", "redirect", "clientError", "serverError"],
    weights,
  );
  const codes: Record<string, number[]> = {
    success: [200, 201, 204],
    redirect: [301, 302, 304],
    clientError: [400, 401, 403, 404, 422, 429],
    serverError: [500, 502, 503, 504],
  };
  const pool = codes[category];
  return pool[randomInt(0, pool.length - 1)];
}

function genLatency(path: string, statusCode: number): number {
  let base = 20;
  if (path.includes("upload")) base = 150;
  else if (path.includes("search")) base = 80;
  else if (path.includes("export")) base = 200;
  else if (path.includes("payment")) base = 100;
  else if (path.includes("reports")) base = 120;
  else if (path.includes("auth")) base = 40;
  else if (path.includes("webhook")) base = 60;

  if (statusCode >= 500) base *= Math.random() > 0.5 ? 0.5 : 3;
  else if (statusCode >= 400) base *= 0.6;

  const jitter = Math.random() * base * 0.5;
  const spike =
    Math.random() > 0.95
      ? randomInt(500, 2000)
      : Math.random() > 0.9
        ? randomInt(200, 500)
        : 0;
  return Math.round(base + jitter + spike);
}

function seedRequestsForUser(userId: number, count: number): void {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const def = ENDPOINT_DEFS[randomInt(0, ENDPOINT_DEFS.length - 1)];
    const method = def.methods[randomInt(0, def.methods.length - 1)];
    const path = def.path.replace(":id", String(randomInt(1, 9999)));
    const statusCode = genStatusCode(def.path);
    const latencyMs = genLatency(def.path, statusCode);
    const createdAt = new Date(
      Math.round(sevenDaysAgo + Math.pow(Math.random(), 0.7) * (now - sevenDaysAgo)),
    );

    requests.push({
      id: nextRequestId++,
      userId,
      endpoint: path,
      method,
      statusCode,
      latencyMs,
      errorMessage:
        statusCode >= 400 ? (ERROR_MESSAGES[statusCode] ?? "Unknown error") : null,
      requestHeaders: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Request-ID": `req-${userId}-${i}`,
      },
      responseSize: statusCode < 400 ? randomInt(100, 50000) : randomInt(50, 500),
      sourceIp: SOURCE_IPS[randomInt(0, SOURCE_IPS.length - 1)],
      userAgent: USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)],
      createdAt,
    });
  }
}

function seedAlertsForUser(userId: number): void {
  const now = Date.now();
  const template: Omit<Alert, "id" | "userId" | "createdAt">[] = [
    {
      type: "latency_spike",
      severity: "warning",
      endpoint: "/api/v1/search",
      message: "Endpoint /api/v1/search latency increased to 850ms (threshold: 500ms)",
      details: { currentLatency: 850, threshold: 500, previousAvg: 120 },
      acknowledged: 0,
      acknowledgedBy: null,
      acknowledgedAt: null,
    },
    {
      type: "failure_rate_spike",
      severity: "critical",
      endpoint: "/api/v1/payments/process",
      message: "Payment processing failure rate reached 35% in the last hour",
      details: { failureRate: 35, threshold: 10, totalRequests: 120, failedRequests: 42 },
      acknowledged: 0,
      acknowledgedBy: null,
      acknowledgedAt: null,
    },
    {
      type: "error_rate_threshold",
      severity: "warning",
      endpoint: "/api/v1/uploads",
      message: "Upload endpoint returning 413 Payload Too Large errors",
      details: { statusCode: 413, count: 25, timeWindow: "1h" },
      acknowledged: 0,
      acknowledgedBy: null,
      acknowledgedAt: null,
    },
    {
      type: "endpoint_down",
      severity: "critical",
      endpoint: "/api/v1/webhooks",
      message: "Webhook endpoint returning 503 Service Unavailable",
      details: { statusCode: 503, consecutiveFailures: 15, downtime: "12 minutes" },
      acknowledged: 1,
      acknowledgedBy: userId,
      acknowledgedAt: new Date(now - 30 * 60 * 1000),
    },
    {
      type: "latency_spike",
      severity: "info",
      endpoint: "/api/v1/reports/sales",
      message: "Report generation latency normalized to 180ms",
      details: { currentLatency: 180, previousAvg: 450, trend: "improving" },
      acknowledged: 1,
      acknowledgedBy: userId,
      acknowledgedAt: new Date(now - 60 * 60 * 1000),
    },
  ];

  const offsets = [2, 0.75, 3, 4, 6].map((h) => h * 60 * 60 * 1000);
  template.forEach((t, i) => {
    alerts.push({
      ...t,
      id: nextAlertId++,
      userId,
      createdAt: new Date(now - offsets[i]),
    });
  });
}

function seed(): void {
  users = [];
  requests = [];
  alerts = [];
  nextUserId = 1;
  nextRequestId = 1;
  nextAlertId = 1;

  const { salt, hash } = hashPassword(DEMO_USER.password);
  const demoUser: User = {
    id: nextUserId++,
    email: DEMO_USER.email,
    passwordHash: hash,
    passwordSalt: salt,
    supabaseId: null,
    clerkId: null,
    unionId: null,
    name: "Demo User",
    avatar: null,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignInAt: new Date(),
  };
  users.push(demoUser);

  seedRequestsForUser(demoUser.id, 1500);
  seedAlertsForUser(demoUser.id);

  seeded = true;
}

function ensureSeeded(): void {
  if (!seeded) seed();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function rangeMs(
  range: TimeRange,
  startDate?: Date,
  endDate?: Date,
): { since: number; until: number } {
  const bounds = getDateBounds(range, startDate, endDate);
  return { since: bounds.since.getTime(), until: bounds.until.getTime() };
}

function matches(filters: RequestFilters, r: ApiRequest): boolean {
  if (filters.endpoint && r.endpoint !== filters.endpoint) return false;
  if (filters.method && r.method !== filters.method) return false;
  if (filters.statusCode && r.statusCode !== filters.statusCode) return false;
  if (filters.startDate && r.createdAt.getTime() < new Date(String(filters.startDate)).getTime())
    return false;
  if (filters.endDate && r.createdAt.getTime() > new Date(String(filters.endDate)).getTime())
    return false;
  if (filters.timeRange) {
    const bounds = rangeMs(filters.timeRange, filters.startDate, filters.endDate);
    const timestamp = r.createdAt.getTime();
    if (timestamp < bounds.since || timestamp > bounds.until) return false;
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    if (!`${r.endpoint} ${r.errorMessage ?? ""}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

// ─── Users ────────────────────────────────────────────────────────────

export function findUserById(id: number): User | undefined {
  ensureSeeded();
  return users.find((u) => u.id === id);
}

export function findUserByEmail(email: string): User | undefined {
  ensureSeeded();
  const normalized = email.toLowerCase();
  return users.find((u) => u.email.toLowerCase() === normalized);
}

export function findUserBySupabaseId(supabaseId: string): User | undefined {
  ensureSeeded();
  return users.find((u) => u.supabaseId === supabaseId);
}

export function findUserByClerkId(clerkId: string): User | undefined {
  ensureSeeded();
  return users.find((u) => u.clerkId === clerkId);
}

export function createUser(input: NewUserInput): User {
  ensureSeeded();
  const id = nextUserId++;
  const user: User = {
    id,
    email: input.email,
    passwordHash: input.passwordHash ?? null,
    passwordSalt: input.passwordSalt ?? null,
    supabaseId: input.supabaseId ?? null,
    clerkId: input.clerkId ?? null,
    unionId: null,
    name: input.name,
    avatar: null,
    role: input.role ?? "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignInAt: new Date(),
  };
  users.push(user);

  // Give every new account its own seeded monitoring dataset.
  seedRequestsForUser(id, 400);
  seedAlertsForUser(id);
  return user;
}

export function upsertSupabaseUser(
  supabaseId: string,
  email: string,
  role: "user" | "admin",
): User {
  ensureSeeded();
  const bySupabase = users.find((u) => u.supabaseId === supabaseId);
  if (bySupabase) {
    bySupabase.email = email || bySupabase.email;
    bySupabase.lastSignInAt = new Date();
    return bySupabase;
  }
  const byEmail = email ? findUserByEmail(email) : undefined;
  if (byEmail) {
    byEmail.supabaseId = supabaseId;
    byEmail.lastSignInAt = new Date();
    return byEmail;
  }
  return createUser({
    email: email || `user-${supabaseId.slice(0, 8)}@anonymous.local`,
    name: null,
    supabaseId,
    role,
  });
}

export function upsertClerkUser(
  clerkId: string,
  email: string,
  name: string | null,
  avatar: string | null,
  role: "user" | "admin",
): User {
  ensureSeeded();
  const byClerk = users.find((u) => u.clerkId === clerkId);
  if (byClerk) {
    byClerk.email = email || byClerk.email;
    byClerk.name = name ?? byClerk.name;
    byClerk.avatar = avatar;
    byClerk.lastSignInAt = new Date();
    return byClerk;
  }

  const byEmail = email ? findUserByEmail(email) : undefined;
  if (byEmail) {
    byEmail.clerkId = clerkId;
    byEmail.name = name ?? byEmail.name;
    byEmail.avatar = avatar;
    byEmail.lastSignInAt = new Date();
    return byEmail;
  }

  return createUser({
    email: email || `user-${clerkId.slice(0, 8)}@clerk.local`,
    name,
    clerkId,
    avatar,
    role,
  });
}

export function updateLastSignIn(id: number): void {
  ensureSeeded();
  const user = users.find((u) => u.id === id);
  if (user) user.lastSignInAt = new Date();
}

export function setUserPassword(
  id: number,
  passwordHash: string,
  passwordSalt: string,
): void {
  ensureSeeded();
  const user = users.find((u) => u.id === id);
  if (user) {
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.updatedAt = new Date();
  }
}

// ─── Requests ─────────────────────────────────────────────────────────

export function requestLogs(
  filters: RequestFilters,
  pagination: PaginationParams,
  userId: number,
): { items: ApiRequest[]; total: number } {
  ensureSeeded();
  const { page = 1, pageSize = 50, sortBy = "createdAt", sortOrder = "desc" } = pagination;
  const rows = requests.filter((r) => r.userId === userId && matches(filters, r));

  rows.sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    if (sortBy === "latencyMs") {
      av = a.latencyMs;
      bv = b.latencyMs;
    } else if (sortBy === "statusCode") {
      av = a.statusCode;
      bv = b.statusCode;
    } else if (sortBy === "endpoint") {
      av = a.endpoint;
      bv = b.endpoint;
    } else if (sortBy === "method") {
      av = a.method;
      bv = b.method;
    } else {
      av = a.createdAt.getTime();
      bv = b.createdAt.getTime();
    }

    if (typeof av === "string" && typeof bv === "string") {
      return sortOrder === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const an = av as number;
    const bn = bv as number;
    return sortOrder === "asc" ? an - bn : bn - an;
  });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total };
}

export function requestLogById(id: number, userId: number): ApiRequest | undefined {
  ensureSeeded();
  return requests.find((r) => r.id === id && r.userId === userId);
}

export function createRequestLog(data: InsertApiRequest): ApiRequest {
  ensureSeeded();
  const request: ApiRequest = {
    id: nextRequestId++,
    userId: data.userId ?? 0,
    endpoint: data.endpoint,
    method: data.method,
    statusCode: data.statusCode,
    latencyMs: data.latencyMs,
    errorMessage: data.errorMessage ?? null,
    requestHeaders: data.requestHeaders ?? null,
    responseSize: data.responseSize ?? null,
    sourceIp: data.sourceIp ?? null,
    userAgent: data.userAgent ?? null,
    createdAt: data.createdAt ?? new Date(),
  };
  requests.unshift(request);
  return request;
}

// ─── Overview / KPIs ──────────────────────────────────────────────────

export function overview(range: TimeRange, userId: number, startDate?: Date, endDate?: Date): OverviewMetrics {
  ensureSeeded();
  const { since, until } = rangeMs(range, startDate, endDate);
  const prevSince = since - (until - since);

  const mine = requests.filter((r) => r.userId === userId);
  const cur = mine.filter((r) => {
    const timestamp = r.createdAt.getTime();
    return timestamp >= since && timestamp <= until;
  });
  const prev = mine.filter((r) => {
    const t = r.createdAt.getTime();
    return t >= prevSince && t < since;
  });

  const total = cur.length;
  const failed = cur.filter((r) => r.statusCode >= 400).length;
  const latencies = cur.map((r) => r.latencyMs).sort((a, b) => a - b);
  const avgLatency = total ? cur.reduce((s, r) => s + r.latencyMs, 0) / total : 0;
  const failureRate = total ? (failed / total) * 100 : 0;
  const prevTotal = prev.length;
  const prevFailed = prev.filter((r) => r.statusCode >= 400).length;
  const prevFailureRate = prevTotal ? (prevFailed / prevTotal) * 100 : 0;

  return {
    totalRequests: total,
    failedRequests: failed,
    failureRate: round2(failureRate),
    avgLatencyMs: round2(avgLatency),
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    requestsChangePercent: prevTotal ? round2(((total - prevTotal) / prevTotal) * 100) : 0,
    failureRateChangePercent: round2(failureRate - prevFailureRate),
    latencyChangePercent: 0,
    activeEndpoints: new Set(cur.map((r) => r.endpoint)).size,
  };
}

// ─── Time series ──────────────────────────────────────────────────────

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function bucketOf(
  d: Date,
  groupBy: "minute" | "hour" | "day",
): { key: string; ts: Date } {
  if (groupBy === "minute") {
    return {
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()),
    };
  }
  if (groupBy === "hour") {
    return {
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`,
      ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()),
    };
  }
  return {
    key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
  };
}

export function timeSeries(
  range: TimeRange,
  groupBy: "minute" | "hour" | "day",
  userId: number,
  startDate?: Date,
  endDate?: Date,
): TimeSeriesPoint[] {
  ensureSeeded();
  const { since, until } = rangeMs(range, startDate, endDate);
  const buckets = new Map<string, { ts: Date; total: number; failed: number; sumLat: number }>();

  for (const r of requests) {
    if (r.userId !== userId || r.createdAt.getTime() < since || r.createdAt.getTime() > until) continue;
    const b = bucketOf(r.createdAt, groupBy);
    const agg = buckets.get(b.key) ?? { ts: b.ts, total: 0, failed: 0, sumLat: 0 };
    agg.total += 1;
    if (r.statusCode >= 400) agg.failed += 1;
    agg.sumLat += r.latencyMs;
    buckets.set(b.key, agg);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({
      timestamp: v.ts,
      total: v.total,
      failed: v.failed,
      avgLatency: round2(v.total ? v.sumLat / v.total : 0),
    }));
}

// ─── Endpoints ────────────────────────────────────────────────────────

export function endpoints(range: TimeRange, limit: number | undefined, userId: number, startDate?: Date, endDate?: Date): Endpoint[] {
  ensureSeeded();
  const { since, until } = rangeMs(range, startDate, endDate);
  const map = new Map<
    string,
    { path: string; method: string; total: number; failed: number; lats: number[]; last: Date }
  >();

  for (const r of requests) {
    if (r.userId !== userId || r.createdAt.getTime() < since || r.createdAt.getTime() > until) continue;
    const key = `${r.method} ${r.endpoint}`;
    const agg = map.get(key) ?? {
      path: r.endpoint,
      method: r.method,
      total: 0,
      failed: 0,
      lats: [],
      last: r.createdAt,
    };
    agg.total += 1;
    if (r.statusCode >= 400) agg.failed += 1;
    agg.lats.push(r.latencyMs);
    if (r.createdAt.getTime() > agg.last.getTime()) agg.last = r.createdAt;
    map.set(key, agg);
  }

  const list = [...map.values()].map((v) => {
    const avg = v.total ? v.lats.reduce((s, n) => s + n, 0) / v.total : 0;
    return {
      id: 0,
      path: v.path,
      method: v.method,
      totalRequests: v.total,
      successfulRequests: v.total - v.failed,
      failedRequests: v.failed,
      avgLatencyMs: round2(avg),
      maxLatencyMs: v.lats.length ? Math.max(...v.lats) : 0,
      minLatencyMs: v.lats.length ? Math.min(...v.lats) : 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      lastRequestedAt: v.last,
      updatedAt: new Date(),
    };
  });

  list.sort((a, b) => b.totalRequests - a.totalRequests);
  return limit ? list.slice(0, limit) : list;
}

export function getOrCreateEndpoint(): number {
  ensureSeeded();
  return 1;
}

// ─── Distributions ────────────────────────────────────────────────────

export function statusDistribution(range: TimeRange, userId: number, startDate?: Date, endDate?: Date): StatusCodeDistribution[] {
  ensureSeeded();
  const { since, until } = rangeMs(range, startDate, endDate);
  const map = new Map<number, number>();
  for (const r of requests) {
    if (r.userId !== userId || r.createdAt.getTime() < since || r.createdAt.getTime() > until) continue;
    map.set(r.statusCode, (map.get(r.statusCode) ?? 0) + 1);
  }
  const total = [...map.values()].reduce((s, n) => s + n, 0);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([statusCode, count]) => ({
      statusCode,
      count,
      percentage: total ? round2((count / total) * 100) : 0,
    }));
}

function latencyBucket(ms: number): string {
  if (ms < 50) return "< 50ms";
  if (ms < 100) return "50-100ms";
  if (ms < 200) return "100-200ms";
  if (ms < 500) return "200-500ms";
  if (ms < 1000) return "500ms-1s";
  return "> 1s";
}

export function latencyDistribution(
  range: TimeRange,
  endpoint: string | undefined,
  userId: number,
  startDate?: Date,
  endDate?: Date,
): LatencyDistribution[] {
  ensureSeeded();
  const { since, until } = rangeMs(range, startDate, endDate);
  const order = ["< 50ms", "50-100ms", "100-200ms", "200-500ms", "500ms-1s", "> 1s"];
  const map = new Map<string, number>();
  for (const r of requests) {
    if (r.userId !== userId || r.createdAt.getTime() < since || r.createdAt.getTime() > until) continue;
    if (endpoint && r.endpoint !== endpoint) continue;
    const b = latencyBucket(r.latencyMs);
    map.set(b, (map.get(b) ?? 0) + 1);
  }
  return order.filter((b) => map.has(b)).map((b) => ({ bucket: b, count: map.get(b) ?? 0 }));
}

export function methodDistribution(range: TimeRange, userId: number, startDate?: Date, endDate?: Date): MethodDistribution[] {
  ensureSeeded();
  const { since, until } = rangeMs(range, startDate, endDate);
  const map = new Map<string, number>();
  for (const r of requests) {
    if (r.userId !== userId || r.createdAt.getTime() < since || r.createdAt.getTime() > until) continue;
    map.set(r.method, (map.get(r.method) ?? 0) + 1);
  }
  const total = [...map.values()].reduce((s, n) => s + n, 0);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => ({
      method,
      count,
      percentage: total ? round2((count / total) * 100) : 0,
    }));
}

// ─── Alerts ───────────────────────────────────────────────────────────

export function alertsList(
  filters: {
    severity?: string;
    acknowledged?: boolean;
    type?: string;
  },
  userId: number,
): Alert[] {
  ensureSeeded();
  return alerts
    .filter((a) => {
      if (a.userId !== userId) return false;
      if (filters.severity && a.severity !== filters.severity) return false;
      if (filters.type && a.type !== filters.type) return false;
      if (filters.acknowledged !== undefined && a.acknowledged !== (filters.acknowledged ? 1 : 0))
        return false;
      return true;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function createAlert(data: InsertAlert): Alert {
  ensureSeeded();
  const alert: Alert = {
    id: nextAlertId++,
    userId: data.userId ?? 0,
    type: data.type,
    severity: data.severity ?? "warning",
    endpoint: data.endpoint ?? null,
    message: data.message,
    details: data.details ?? null,
    acknowledged: 0,
    acknowledgedBy: null,
    acknowledgedAt: null,
    createdAt: new Date(),
  };
  alerts.unshift(alert);
  return alert;
}

export function acknowledge(alertId: number, userId: number): void {
  ensureSeeded();
  const a = alerts.find((x) => x.id === alertId && x.userId === userId);
  if (a) {
    a.acknowledged = 1;
    a.acknowledgedAt = new Date();
    a.acknowledgedBy = userId;
  }
}

// ─── Insights ─────────────────────────────────────────────────────────

export function insights(range: TimeRange, userId: number, startDate?: Date, endDate?: Date): AutomatedInsight[] {
  ensureSeeded();
  const { since, until } = rangeMs(range, startDate, endDate);
  const rows = requests.filter((r) => {
    const timestamp = r.createdAt.getTime();
    return r.userId === userId && timestamp >= since && timestamp <= until;
  });
  const out: AutomatedInsight[] = [];

  const total = rows.length;
  const failed = rows.filter((r) => r.statusCode >= 400).length;
  const failureRate = total ? (failed / total) * 100 : 0;

  if (failureRate > 10) {
    out.push({
      type: "critical",
      message: "High failure rate detected",
      detail: `${failureRate.toFixed(1)}% of requests failed in the last ${range}`,
      metric: "failureRate",
      changePercent: failureRate,
    });
  } else if (failureRate > 5) {
    out.push({
      type: "warning",
      message: "Elevated failure rate",
      detail: `${failureRate.toFixed(1)}% of requests are failing`,
      metric: "failureRate",
      changePercent: failureRate,
    });
  }

  const slow = endpoints(range, undefined, userId, startDate, endDate)
    .filter((e) => e.totalRequests >= 5)
    .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
    .slice(0, 1);
  if (slow.length > 0 && slow[0].avgLatencyMs > 500) {
    out.push({
      type: slow[0].avgLatencyMs > 1000 ? "critical" : "warning",
      message: "Slow endpoint detected",
      detail: `${slow[0].path} averages ${slow[0].avgLatencyMs.toFixed(0)}ms response time`,
      endpoint: slow[0].path,
      metric: "avgLatency",
    });
  }

  const failing = endpoints(range, undefined, userId, startDate, endDate)
    .filter((e) => e.totalRequests >= 5)
    .map((e) => ({
      ...e,
      failRate: e.totalRequests ? (e.failedRequests / e.totalRequests) * 100 : 0,
    }))
    .sort((a, b) => b.failRate - a.failRate)
    .slice(0, 1);
  if (failing.length > 0 && failing[0].failRate > 20) {
    out.push({
      type: "critical",
      message: "Endpoint with high failure rate",
      detail: `${failing[0].path} has ${failing[0].failRate.toFixed(1)}% failure rate (${failing[0].failedRequests}/${failing[0].totalRequests} requests)`,
      endpoint: failing[0].path,
      metric: "failureRate",
    });
  }

  const hourAgo = Date.now() - 60 * 60 * 1000;
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const recent = requests.filter(
    (r) => r.userId === userId && r.createdAt.getTime() >= hourAgo,
  ).length;
  const prev = requests.filter((r) => {
    const t = r.createdAt.getTime();
    return r.userId === userId && t >= twoHoursAgo && t < hourAgo;
  }).length;
  if (prev > 0) {
    const change = ((recent - prev) / prev) * 100;
    if (change > 50) {
      out.push({
        type: "info",
        message: "Request volume spike",
        detail: `Traffic increased by ${change.toFixed(0)}% compared to previous hour (${recent} vs ${prev} requests)`,
        metric: "requestVolume",
        changePercent: round2(change),
      });
    } else if (change < -50) {
      out.push({
        type: "warning",
        message: "Request volume drop",
        detail: `Traffic decreased by ${Math.abs(change).toFixed(0)}% compared to previous hour`,
        metric: "requestVolume",
        changePercent: round2(change),
      });
    }
  }

  return out;
}

// ─── Export ───────────────────────────────────────────────────────────

export function exportRequests(
  filters: RequestFilters,
  format: "csv" | "json",
  userId: number,
): string {
  ensureSeeded();
  const rows = requests
    .filter((r) => r.userId === userId && matches(filters, r))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (format === "json") {
    return JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        timestamp: r.createdAt.toISOString(),
        endpoint: r.endpoint,
        method: r.method,
        statusCode: r.statusCode,
        latencyMs: r.latencyMs,
        errorMessage: r.errorMessage,
        responseSize: r.responseSize,
        sourceIp: r.sourceIp,
        userAgent: r.userAgent,
      })),
      null,
      2,
    );
  }

  const headers = [
    "ID",
    "Timestamp",
    "Endpoint",
    "Method",
    "Status Code",
    "Latency (ms)",
    "Error Message",
    "Response Size",
    "Source IP",
    "User Agent",
  ];
  const body = rows.map((r) => [
    r.id,
    r.createdAt.toISOString(),
    `"${r.endpoint}"`,
    r.method,
    r.statusCode,
    r.latencyMs,
    r.errorMessage ? `"${r.errorMessage.replace(/"/g, '""')}"` : "",
    r.responseSize ?? "",
    r.sourceIp ?? "",
    r.userAgent ? `"${r.userAgent.replace(/"/g, '""')}"` : "",
  ]);
  return [headers.join(","), ...body.map((row) => row.join(","))].join("\n");
}

// ─── Lifecycle helpers (used by the seed router) ──────────────────────

export function clear(userId: number): void {
  ensureSeeded();
  requests = requests.filter((r) => r.userId !== userId);
  alerts = alerts.filter((a) => a.userId !== userId);
}

export function reseed(userId: number): void {
  ensureSeeded();
  clear(userId);
  seedRequestsForUser(userId, userId === 1 ? 1500 : 400);
  seedAlertsForUser(userId);
}
