import type { NextRequest } from "next/server";

/** Beveiligingslinks komen uitsluitend uit configuratie, nooit uit requestheaders of de database. */
export function applicationOrigin(): string {
  const configured = process.env.APP_URL?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") throw new Error("APP_URL is verplicht in productie.");
    return `http://localhost:${process.env.PORT || "3000"}`;
  }
  const url = new URL(configured);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("APP_URL moet een HTTPS-oorsprong zijn (lokaal mag HTTP).");
  }
  return url.origin;
}

export function getBaseUrl(req: NextRequest): string {
  void req;
  return applicationOrigin();
}

export async function getAppUrl(): Promise<string> {
  return applicationOrigin();
}
