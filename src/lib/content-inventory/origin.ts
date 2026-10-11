/** SameSite=Lax aanvullen met een expliciete origincontrole voor deze beheeractie. */
export function inventoryOriginAllowed(headers: Headers, requestUrl: string, configuredUrl?: string): boolean {
  const raw = headers.get("origin");
  if (!raw || raw === "null" || headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    const origin = new URL(raw);
    if (raw !== origin.origin || !["http:", "https:"].includes(origin.protocol)) return false;
    if (configuredUrl) return origin.origin === new URL(configuredUrl).origin;
    // De bestaande nginx zet Host op de publieke host. Next's interne
    // requestUrl kan localhost bevatten. Geen database/cache-detectie nodig.
    const request = new URL(requestUrl);
    const host = headers.get("host") ?? request.host;
    // HTTPS mag vóór de interne HTTP-proxy eindigen (Cloudflare/Synology).
    // De host, inclusief poort, moet ook dan exact gelijk blijven.
    return origin.host === host && (origin.protocol === request.protocol || origin.protocol === "https:");
  } catch { return false; }
}
