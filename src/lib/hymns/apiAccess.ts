import { getCurrentUser } from "@/lib/session";
import { getHymnsAccess } from "@/lib/hymnAvailability";

// Toegang tot de Lofzangen-API: dezelfde regel als de pagina (hymnsPocAccess). Wie geen toegang heeft, krijgt 404
// (niet 401/403), zodat de bestaansreden van de routes niet te raden is. Alleen vanuit route handlers gebruiken.
export async function hymnsApiAllowed(): Promise<boolean> {
  return (await getHymnsAccess(await getCurrentUser())) === "allow";
}

// De aangepaste server (server.ts) comprimeert antwoorden niet zelf; de grote bibliotheekantwoorden (herkenningsbundel ~0,5 MB,
// index ~60 KB) gaan daarom gzip-gecomprimeerd terug als de browser dat vraagt. Het gecomprimeerde resultaat wordt per dataversie
// onthouden, zodat het comprimeren één keer per proces gebeurt.
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";

const compressed = new Map<string, Buffer>();

export function jsonMaybeGzip(req: Request, key: string, body: unknown, headers: Record<string, string> = {}): NextResponse {
  const wantsGzip = /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
  const base = { "Content-Type": "application/json", Vary: "Cookie, Accept-Encoding", ...headers };
  if (!wantsGzip) return new NextResponse(JSON.stringify(body), { headers: base });
  let buf = compressed.get(key);
  if (!buf) {
    buf = gzipSync(JSON.stringify(body), { level: 6 });
    compressed.set(key, buf);
  }
  return new NextResponse(new Uint8Array(buf), { headers: { ...base, "Content-Encoding": "gzip" } });
}
