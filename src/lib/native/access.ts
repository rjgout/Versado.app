import { z } from "zod";
import { NativeClientError } from "./client";

export const INTERNAL_ACCESS_ORIGIN = "https://dev.versado.app";
export interface NativeAccessBridge {
  accessStatus(): Promise<{ enabled: boolean; configured: boolean }>;
  enrollAccess(options: { language: string }): Promise<{ changed: boolean }>;
  clearAccess(): Promise<{ changed: boolean }>;
  accessRequest(options: { path: string; method: string; authorization?: string; body?: string }): Promise<{ status: number; body: string }>;
}
const replySchema = z.object({ status: z.number().int().min(200).max(599), body: z.string().max(1_048_576) }).strict();
const errors = new Set(["access_missing", "access_denied", "access_disabled", "access_changed", "access_cancelled", "access_busy", "access_storage_unavailable", "access_request_invalid", "access_redirect_blocked", "access_invalid_response", "access_network_unavailable"]);
export function nativeAccessError(error: unknown): NativeClientError {
  const code = error instanceof Error ? error.message : "";
  return new NativeClientError(errors.has(code) ? code : "access_unavailable"); // Geen native foutdetails of 401 naar de sessierotatie lekken.
}
export function accessRouteAllowed(path: string, method: string): boolean {
  if (method === "GET") return ["capabilities", "me", "today"].includes(path) || /^chapters\/[A-Za-z0-9_-]{1,128}$/.test(path);
  if (method === "POST") return ["login", "register", "forgot-password", "reset-password", "verify-email", "refresh", "logout", "security-setup/complete", "security-setup/cancel", "apple/challenge", "apple/complete", "account/password"].includes(path) || /^chapters\/[A-Za-z0-9_-]{1,128}\/complete$/.test(path);
  return method === "DELETE" && ["apple", "account"].includes(path); // WP4-accountendpoint blijft afzonderlijk werk.
}
/** Alleen pad/body/Bearer gaan naar native. Geen servicecredential komt uit de bridge terug. */
export function nativeAccessTransport(bridge: NativeAccessBridge): typeof fetch {
  return async (input, init) => {
    const prefix = `${INTERNAL_ACCESS_ORIGIN}/api/v1/native/`;
    if (typeof input !== "string" || !input.startsWith(prefix)) throw new NativeClientError("access_request_invalid");
    const path = input.slice(prefix.length), method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (!accessRouteAllowed(path, method) || [...headers.keys()].some(key => !["authorization", "content-type", "x-versado-client"].includes(key)) ||
      (init?.credentials && init.credentials !== "omit") || (init?.redirect && init.redirect !== "error") ||
      (init?.body !== undefined && typeof init.body !== "string") || (method === "GET" && init?.body !== undefined) ||
      (typeof init?.body === "string" && new TextEncoder().encode(init.body).byteLength > 16_384)) throw new NativeClientError("access_request_invalid");
    if (init?.signal?.aborted) throw new NativeClientError("access_network_unavailable");
    let value;
    try {
      const pending = bridge.accessRequest({ path, method, ...(headers.has("authorization") ? { authorization: headers.get("authorization")! } : {}), ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      const signal = init?.signal;
      const received = signal ? await new Promise<Awaited<typeof pending>>((resolve, reject) => {
        const abort = () => { signal.removeEventListener("abort", abort); reject(new NativeClientError("access_network_unavailable")); };
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
        pending.then(result => { signal.removeEventListener("abort", abort); resolve(result); }, error => { signal.removeEventListener("abort", abort); reject(error); });
      }) : await pending;
      value = replySchema.parse(received);
    } catch (error) { throw nativeAccessError(error); }
    if (init?.signal?.aborted) throw new NativeClientError("access_network_unavailable");
    let data; try { data = JSON.parse(value.body); } catch { throw new NativeClientError("access_invalid_response"); }
    // Een edge-401 mag een bewaarde Versado-refreshintentie nooit als ongeldige sessie verwijderen.
    if (value.status === 401 && ["refresh", "logout"].includes(path) && !["session_expired", "session_changed", "web_security_setup_required"].includes(data?.error)) throw new NativeClientError("access_denied");
    return new Response(value.body, { status: value.status, headers: { "Content-Type": "application/json" } });
  };
}
