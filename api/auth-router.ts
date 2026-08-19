import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Session } from "@contracts/constants";
import type { User } from "@db/schema";
import { getSessionCookieOptions } from "./lib/cookies";
import { env } from "./lib/env";
import { hashPassword, verifyPassword } from "./auth/password";
import {
  checkAuthRateLimit,
  clientIp,
  recordAuthFailure,
  clearAuthFailures,
} from "./lib/auth-rate-limit";
import { signSessionToken, verifySupabaseToken } from "./auth/session";
import {
  findUserById,
  findUserByEmail,
  createUser,
  setUserPassword,
  updateLastSignIn,
  upsertSupabaseUser,
  bumpTokenVersion,
} from "./queries/users";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import type { TrpcContext } from "./context";

export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    role: user.role,
    createdAt: user.createdAt,
    lastSignInAt: user.lastSignInAt,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

function setSessionCookie(ctx: TrpcContext, token: string): void {
  const opts = getSessionCookieOptions(ctx.req.headers);
  ctx.resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: Session.maxAgeMs / 1000,
    }),
  );
}

function clearSessionCookie(ctx: TrpcContext): void {
  const opts = getSessionCookieOptions(ctx.req.headers);
  ctx.resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
    }),
  );
}

export type SessionIssueResult = {
  user: PublicUser;
  token: string;
};

/**
 * Issue the application session: an httpOnly cookie for normal requests plus
 * the signed token itself in the response body. The client stores the token
 * and sends it as `Authorization: Bearer <token>` on later requests, so the
 * session survives proxies that strip or rewrite `Set-Cookie` headers (the
 * cause of the hosted-preview sign-in loop).
 */
async function issueSession(
  ctx: TrpcContext,
  user: User,
): Promise<SessionIssueResult> {
  const token = await signSessionToken({
    userId: user.id,
    email: user.email,
    tokenVersion: user.tokenVersion,
  });
  setSessionCookie(ctx, token);
  return { user: toPublicUser(user), token };
}

export const authRouter = createRouter({
  /**
   * Public configuration the login screen needs before any session exists.
   * The Supabase anon key is intentionally public.
   */
  config: publicQuery.query(() => ({
    mode: env.isDemoMode
      ? ("local" as const)
      : env.isClerkMode
        ? ("clerk" as const)
        : env.isSupabaseMode
          ? ("supabase" as const)
          : ("local" as const),
    demoMode: env.isDemoMode,
    clerkEnabled: env.isClerkMode,
    supabaseUrl: env.isSupabaseMode ? env.supabaseUrl : null,
    supabaseAnonKey: env.isSupabaseMode ? env.supabaseAnonKey : null,
    demoCredentials: env.isDemoMode
      ? { email: "demo@example.com", password: "demo1234" }
      : null,
    kimiStatus: env.kimiOpenUrl && env.kimiApiKey ? "real" : env.isDemoMode ? "mock" : "not_connected",
  })),

  me: authedQuery.query(({ ctx }) => toPublicUser(ctx.user)),

  register: publicQuery
    .input(
      z.object({
        email: z.string().email().max(320),
        // Max length prevents a scrypt CPU/memory DoS from an absurdly long
        // password (scrypt cost scales with input size).
        password: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .max(128, "Password must be at most 128 characters"),
        name: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (env.isClerkMode && !env.isDemoMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sign up is handled by Clerk when it is configured.",
        });
      }
      if (env.isSupabaseMode && !env.isDemoMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sign up is handled by Supabase when it is configured.",
        });
      }
      // Gate account creation by source IP to prevent mass sign-up abuse.
      const blocked = checkAuthRateLimit(input.email, clientIp(ctx.req.headers));
      if (blocked) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many attempts. Try again in ${blocked.retryAfterSeconds} seconds.`,
        });
      }
      const email = input.email.toLowerCase().trim();
      const existing = await findUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists.",
        });
      }
      const { salt, hash } = hashPassword(input.password);
      const user = await createUser({
        email,
        name: input.name ?? email.split("@")[0],
        passwordHash: hash,
        passwordSalt: salt,
        role: "user",
      });
      return issueSession(ctx, user);
    }),

  login: publicQuery
    .input(
      z.object({
        email: z.string().email().max(320),
        password: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (env.isClerkMode && !env.isDemoMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sign in is handled by Clerk when it is configured.",
        });
      }
      if (env.isSupabaseMode && !env.isDemoMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sign in is handled by Supabase when it is configured.",
        });
      }
      const email = input.email.toLowerCase().trim();
      const ip = clientIp(ctx.req.headers);

      // Reject before checking credentials once the account or IP is over its
      // failure budget, so brute-force guessing is stopped regardless of
      // whether the email exists.
      const blocked = checkAuthRateLimit(email, ip);
      if (blocked) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many failed sign-in attempts. Try again in ${blocked.retryAfterSeconds} seconds.`,
        });
      }

      const user = await findUserByEmail(email);
      const invalid =
        !user?.passwordHash ||
        !user?.passwordSalt ||
        !verifyPassword(input.password, user.passwordSalt, user.passwordHash);
      if (invalid) {
        recordAuthFailure(email, ip);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
      }

      clearAuthFailures(email);
      await updateLastSignIn(user.id);
      return issueSession(ctx, user);
    }),

  /**
   * Exchange a Supabase access token for an application session.
   * The server verifies the token signature before trusting the identity.
   */
  supabaseLogin: publicQuery
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!env.isSupabaseMode) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Supabase is not configured." });
      }
      const claims = await verifySupabaseToken(input.accessToken);
      if (!claims) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid Supabase session." });
      }
      const user = await upsertSupabaseUser(claims.sub, claims.email ?? "");
      return issueSession(ctx, user);
    }),

  resetPassword: publicQuery
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ input }) => {
      if (!env.isSupabaseMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Password reset is only available when Supabase is configured.",
        });
      }
      // Supabase GoTrue "recover" endpoint sends a reset email.
      const resp = await fetch(`${env.supabaseUrl}/auth/v1/recover`, {
        method: "POST",
        headers: {
          apikey: env.supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: input.email }),
      });
      if (!resp.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to send password reset email.",
        });
      }
      return { success: true };
    }),

  changePassword: authedQuery
    .input(
      z.object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .max(128, "Password must be at most 128 characters"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if ((env.isClerkMode || env.isSupabaseMode) && !env.isDemoMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Manage your password through ${env.isClerkMode ? "Clerk" : "Supabase"}.`,
        });
      }
      const user = await findUserById(ctx.user.id);
      if (!user?.passwordHash || !user?.passwordSalt) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "No local password is set." });
      }
      if (!verifyPassword(input.currentPassword, user.passwordSalt, user.passwordHash)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });
      }
      const { salt, hash } = hashPassword(input.newPassword);
      await setUserPassword(user.id, hash, salt);
      // Revoke every other session (including this one's prior tokens) so a
      // password change immediately kills any session minted with the old
      // credentials — including stolen ones.
      await bumpTokenVersion(user.id);
      return { success: true };
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    // Revoke all outstanding session tokens (bearer + cookie) so a logged-out
    // token cannot be replayed for the rest of its 7-day lifetime.
    await bumpTokenVersion(ctx.user.id);
    clearSessionCookie(ctx);
    return { success: true };
  }),
});
