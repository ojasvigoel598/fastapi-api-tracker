import { createClerkClient, verifyToken } from "@clerk/backend";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import * as cookie from "cookie";
import type { User } from "@db/schema";
import { Session } from "@contracts/constants";
import { verifySessionToken } from "./auth/session";
import { env } from "./lib/env";
import {
  findUserByClerkId,
  findUserById,
  upsertClerkUser,
} from "./queries/users";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

async function authenticateClerkRequest(headers: Headers): Promise<User | undefined> {
  if (!env.isClerkMode) return undefined;

  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return undefined;

  try {
    const claims = await verifyToken(token, { secretKey: env.clerkSecretKey });
    if (typeof claims.sub !== "string") return undefined;

    const existing = await findUserByClerkId(claims.sub);
    if (existing) return existing;

    let email = "";
    let name: string | null = null;
    let avatar: string | null = null;

    // The verified session token establishes identity. Fetch profile details
    // only when linking the Clerk identity to a local application user.
    try {
      const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
      const profile = await clerk.users.getUser(claims.sub);
      email = profile.primaryEmailAddress?.emailAddress ?? "";
      name = profile.fullName ?? profile.username ?? null;
      avatar = profile.imageUrl || null;
    } catch {
      // A verified token is still sufficient to create a stable local identity.
      // Profile fields can be filled on a later successful Clerk API request.
    }

    return upsertClerkUser(claims.sub, email, name, avatar);
  } catch {
    return undefined;
  }
}

export async function authenticateRequest(
  headers: Headers,
): Promise<User | undefined> {
  const clerkUser = await authenticateClerkRequest(headers);
  if (clerkUser) return clerkUser;

  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) return undefined;
  const claim = await verifySessionToken(token);
  if (!claim) return undefined;
  return findUserById(claim.userId);
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional at the context level; individual procedures
    // enforce it via the authedQuery middleware.
  }
  return ctx;
}
