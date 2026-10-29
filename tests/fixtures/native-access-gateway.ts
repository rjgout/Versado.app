// Alleen wegwerptests: gesimuleerde native vault + echte HTTP Access-poort vóór de lokale Versado-testserver.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { NativeAccessBridge } from "../../src/lib/native/access";
import { accessRouteAllowed } from "../../src/lib/native/access";

export async function nativeAccessGateway(backend: string) {
  if (new URL(backend).hostname !== "127.0.0.1") throw new Error("Alleen eigen lokale testbackend");
  const issue = () => ({ id: `synthetic-${randomUUID()}.access`, secret: `synthetic-${randomUUID()}-${randomUUID()}` });
  let issued = issue(), accepted: typeof issued | null = issued, vault: typeof issued | null = null;
  let redirected = false, forwarded = 0, received = 0;
  const calls: unknown[] = [];
  const edge = createServer(async (req, res) => {
    received++;
    if (!accepted || req.headers["cf-access-client-id"] !== accepted.id || req.headers["cf-access-client-secret"] !== accepted.secret) {
      res.writeHead(403, { "Content-Type": "text/html" }); res.end("Synthetic Access denied"); return;
    }
    if (redirected) { res.writeHead(302, { Location: "https://invalid.external.invalid" }); res.end(); return; }
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks), url = new URL(req.url!, "http://127.0.0.1");
      const path = url.pathname.slice("/api/v1/native/".length);
      if (!url.pathname.startsWith("/api/v1/native/") || !accessRouteAllowed(path, req.method!)) { res.writeHead(404); res.end(); return; }
      forwarded++;
      const response = await fetch(backend + url.pathname, { method: req.method, redirect: "manual", headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", "x-real-ip": "127.0.0.82", ...(body.length ? { "Content-Type": "application/json" } : {}), ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, body: body.length ? body : undefined });
      res.writeHead(response.status, { "Content-Type": response.headers.get("content-type") ?? "", "Access-Control-Allow-Origin": response.headers.get("access-control-allow-origin") ?? "" });
      res.end(await response.text());
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => edge.listen(0, "127.0.0.1", resolve));
  const address = edge.address(); if (!address || typeof address === "string") throw new Error("Geen testpoort");
  const origin = `http://127.0.0.1:${address.port}`;
  const bridge: NativeAccessBridge = {
    async accessStatus() { return { enabled: true, configured: vault !== null }; },
    async enrollAccess() { vault = { ...issued }; return { changed: true }; },
    async clearAccess() { vault = null; return { changed: true }; },
    async accessRequest(options) {
      calls.push(options);
      if (!vault) throw new Error("access_missing");
      if (!accessRouteAllowed(options.path, options.method)) throw new Error("access_request_invalid");
      const response = await fetch(`${origin}/api/v1/native/${options.path}`, { method: options.method, redirect: "manual", headers: { "CF-Access-Client-Id": vault.id, "CF-Access-Client-Secret": vault.secret, ...(options.authorization ? { Authorization: options.authorization } : {}), ...(options.body ? { "Content-Type": "application/json" } : {}) }, body: options.body });
      if (response.status >= 300 && response.status < 400) throw new Error("access_redirect_blocked");
      if (response.headers.get("access-control-allow-origin") !== "capacitor://localhost") throw new Error("access_denied");
      return { status: response.status, body: await response.text() };
    },
  };
  return {
    bridge, calls, counts: () => ({ forwarded, received }),
    revoke() { accepted = null; }, rotate() { issued = issue(); accepted = issued; }, redirect(value: boolean) { redirected = value; },
    privateValues: () => [issued.id, issued.secret], // Alleen Node-testasserties; nooit naar een browser/bridge-response.
    async close() { await new Promise<void>((resolve, reject) => edge.close(error => error ? reject(error) : resolve())); },
  };
}
