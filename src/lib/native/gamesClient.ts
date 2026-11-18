import { z } from "zod";
import { NativeClientError, type NativeSessionClient } from "./client";
import { gameApiRoute } from "./gamesRoutes";

const reply = z.object({version:z.literal(1),userId:z.string().min(1).max(128),path:z.string().max(2048),search:z.string().max(8192),method:z.enum(["GET","POST","PUT","PATCH","DELETE"]),status:z.number().int().min(200).max(599),data:z.unknown()}).strict();
export interface GameActor { id: string; stamp: string }
/** De bestaande fetch-interface, uitsluitend voor de expliciete spelcontracten.
 * Nooit cookies, browserauth, vrije hosts of automatisch herhaalde schrijfacties. */
export function nativeGameFetch(client: NativeSessionClient, actor: () => GameActor | null): typeof fetch {
  return async (input, init = {}) => {
    const expected = actor(), stamp = client.getSessionStamp();
    if (!expected || expected.stamp !== stamp) throw new NativeClientError("session_changed",409);
    const method = init.method ?? "GET";
    const match = typeof input === "string" ? gameApiRoute(input,method) : null;
    if (!match || (init.credentials && init.credentials !== "omit") ||
      [...new Headers(init.headers).entries()].some(([key,value]) => key === "accept" ? value !== "application/json" : key !== "content-type" || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(value)) ||
      (init.body !== undefined && typeof init.body !== "string")) throw new NativeClientError("access_request_invalid",400);
    const current = () => {
      if (client.getSessionStamp() !== stamp || actor()?.id !== expected.id) throw new NativeClientError("session_changed",409);
      if (init.signal?.aborted) throw new DOMException("Aborted","AbortError");
    };
    current();
    let body: unknown;
    if (method !== "GET") {
      try { body = init.body === undefined ? {} : JSON.parse(init.body as string); }
      catch { throw new NativeClientError("invalid_input",400); }
    } else if (init.body !== undefined) throw new NativeClientError("invalid_input",400);
    const value = reply.parse(await client.api(`games/${match.path}${match.search}`,body,method,method === "GET"));
    current();
    if (value.userId !== expected.id || value.path !== match.path || value.search !== match.search || value.method !== method) throw new NativeClientError("invalid_response",502);
    return new Response([204,205].includes(value.status) ? null : JSON.stringify(value.data),{status:value.status,headers:{"Content-Type":"application/json","Cache-Control":"private, no-store"}});
  };
}
