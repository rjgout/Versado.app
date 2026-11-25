import { NextRequest } from "next/server";
import type { User } from "@/generated/prisma/client";
import { withNativeGameIdentity } from "@/lib/games/requestIdentity.server";
import { NativeAuthError } from "./sessions";
import { gameApiRoute, nativePersonalListKeyAllowed } from "./gamesRoutes";
import { GAME_HANDLERS } from "./gamesHandlers.server";

/** Dezelfde bestaande webhandelingen, uitsluitend via deze statische spelgrens.
 * Geen HTTP-selfrequest, cookies, client-actor of vrije target-URL. */
export async function dispatchNativeGame(req: NextRequest, parts: string[], user: User, verify: () => Promise<User>) {
  const match = gameApiRoute(`/api/${parts.join("/")}${req.nextUrl.search}`, req.method);
  if (!match) throw new NativeAuthError("endpoint_unavailable",404);
  const handler = GAME_HANDLERS[match.id]?.[req.method];
  if (!handler) throw new NativeAuthError("endpoint_unavailable",404);
  let body: string | undefined;
  if (!["GET","HEAD"].includes(req.method)) {
    const reader = req.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new NativeAuthError("request_too_large",413); }
      chunks.push(next.value);
    }
    body = Buffer.concat(chunks).toString("utf8");
    try {
      const input:unknown=JSON.parse(body);
      // Dezelfde voorkeurservice; uitsluitend de bestaande spel- en cursuslijst.
      if(match.id==="list-order"&&(!input||typeof input!=="object"||!("listKey" in input)||!nativePersonalListKeyAllowed(input.listKey)))throw new NativeAuthError("invalid_input",400);
    } catch { throw new NativeAuthError("invalid_input",400); }
  }
  const headers = new Headers(req.headers);
  headers.delete("cookie"); headers.delete("authorization");
  const target = new URL(`/api/${match.path}${match.search}`,req.nextUrl.origin);
  const request = new NextRequest(target,{method:req.method,headers,body});
  const response = await withNativeGameIdentity(verify,()=>handler(request,match.params),req.headers.get("origin") ?? undefined);
  if (!(response instanceof Response) || (response.status >= 300 && response.status < 400)) throw new NativeAuthError("invalid_response",502);
  if (response.status !== 204 && !response.headers.get("content-type")?.startsWith("application/json")) throw new NativeAuthError("invalid_response",502);
  const latest = await verify();
  if (latest.id !== user.id) throw new NativeAuthError("session_changed",409);
  const data: unknown = response.status === 204 ? null : await response.json();
  return {version:1 as const,userId:user.id,path:match.path,search:match.search,method:req.method,status:response.status,data};
}
