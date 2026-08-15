export type SessionCookieOptions = {
  httpOnly: boolean;
  path: string;
  sameSite: "Lax" | "None";
  secure: boolean;
  partitioned: boolean;
};

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getSessionCookieOptions(headers: Headers): SessionCookieOptions {
  const localhost = isLocalhost(headers);
  const forwardedProto = (headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  const secure = forwardedProto === "https" || !localhost;

  // `Sec-Fetch-Site` tells us whether the browser made this request from a
  // cross-site context (an iframe embedded on a different site, e.g. a hosted
  // preview pane). Only there is SameSite=None required. A Partitioned cookie
  // (CHIPS) must only be set in that cross-site context; applying it to a
  // same-origin/top-level navigation can make browsers drop the cookie and
  // cause a sign-in loop, so we keep it scoped to the cross-site case only.
  const secFetchSite = (headers.get("sec-fetch-site") || "").toLowerCase();

  if (secFetchSite === "cross-site") {
    return {
      httpOnly: true,
      path: "/",
      sameSite: "None",
      secure: true,
      partitioned: true,
    };
  }

  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure,
    partitioned: false,
  };
}
