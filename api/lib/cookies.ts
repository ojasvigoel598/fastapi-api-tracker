export type SessionCookieOptions = {
  httpOnly: boolean;
  path: string;
  sameSite: "Lax" | "None";
  secure: boolean;
};

/**
 * Work out cookie flags that survive every context the app runs in:
 *
 * - localhost dev over plain HTTP: SameSite=Lax, not Secure
 * - hosted preview / production over HTTPS: SameSite=Lax, Secure
 * - a genuine cross-site iframe (the hosted preview pane): SameSite=None,
 *   Secure — a *regular* (non-partitioned) cookie so the same session also
 *   follows the app when it is opened in its own tab.
 *
 * We deliberately never set the `Partitioned` (CHIPS) attribute. A partitioned
 * cookie is scoped to the embedding top-level site, so the moment a user opens
 * the app in a new tab (or the preview pane's top-level origin changes) the
 * cookie disappears and the browser bounces straight back to sign-in.
 *
 * `Secure` is derived from the actual client-facing protocol (`x-forwarded-proto`)
 * instead of the hostname. Marking a cookie `Secure` while serving over plain
 * HTTP makes browsers silently drop it — which reproduces exactly the
 * "sign in, then immediately back to sign-in" loop. When the protocol is
 * unknown we err on the side of *not* setting Secure, since a non-Secure
 * cookie still works over HTTPS, whereas a Secure cookie over HTTP is dropped.
 */
export function getSessionCookieOptions(headers: Headers): SessionCookieOptions {
  const forwardedProto = (headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  const secure = forwardedProto === "https";

  const secFetchSite = (headers.get("sec-fetch-site") || "").toLowerCase();
  if (secFetchSite === "cross-site") {
    // SameSite=None is required for a cookie to be sent from a cross-site
    // iframe, and browsers require Secure alongside it.
    return {
      httpOnly: true,
      path: "/",
      sameSite: "None",
      secure: true,
    };
  }

  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure,
  };
}
