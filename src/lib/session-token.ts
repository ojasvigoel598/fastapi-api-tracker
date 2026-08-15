const TOKEN_KEY = "app_session_token";

/**
 * Client-side mirror of the signed application-session token.
 *
 * The server still sets an httpOnly cookie, but hosted preview proxies can
 * strip or rewrite `Set-Cookie` headers (which causes the "sign in, then back
 * to sign-in" loop). Storing the token here and sending it as an
 * `Authorization: Bearer` header makes the session survive those proxies.
 *
 * This value is signed by the server with `APP_SECRET` (HS256), not a raw
 * credential, and it is only meaningful alongside the rest of the session.
 */
export function setSessionToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage can be unavailable (privacy mode / partitioned storage). The
    // httpOnly cookie remains the fallback in that case.
  }
}

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
