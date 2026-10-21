import { applicationOrigin } from "./baseUrl";

/** Native bearer-auth en RFC8058 hebben eigen origin-/tokencontroles. */
export function requestSecurityError(method: string, pathname: string, headers: Headers): number | null {
  if (!pathname.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(method) ||
      pathname.startsWith("/api/v1/native/") || pathname === "/api/unsubscribe") return null;
  const origin = headers.get("origin");
  const site = headers.get("sec-fetch-site");
  if (origin ? origin !== applicationOrigin() : site === "cross-site" || site === "same-site") return 403;
  const contentType = headers.get("content-type");
  if (contentType && contentType.split(";")[0].trim().toLowerCase() !== "application/json") return 415;
  return null;
}
