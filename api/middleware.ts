import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Explicitly server-side. Together with `isDev` (which defaults to
  // `NODE_ENV !== "production"`), this guarantees tRPC never serializes
  // stack traces into client responses in production.
  isServer: true,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/**
 * Gate an authenticated procedure on a verified email address. Accounts
 * created through Supabase/Clerk and pre-existing accounts are verified
 * (see the migration backfill), so only genuinely unverified local sign-ups
 * are blocked — the case where an attacker owns the inbox is unproven.
 */
const requireVerified = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }
  if (!ctx.user.emailVerifiedAt) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Email verification required to perform this action.",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const authedQuery = t.procedure.use(requireAuth);
export const verifiedQuery = authedQuery.use(requireVerified);
export const adminQuery = authedQuery.use(requireRole("admin"));
