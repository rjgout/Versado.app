import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { AnnotationError, legacyVerseAnnotation } from "./service";
import type { AnnotationKind } from "./contract";

export const annotationResponse = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: {
  "Cache-Control": "no-store, private", Vary: "Cookie", "X-Content-Type-Options": "nosniff",
} });
export async function annotationJson(req: Request, limit = 131072): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) return null; chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}
export async function legacyAnnotationRoute(req: Request, verseId: string, kind: AnnotationKind) {
  const user = await getCurrentUser(), t = getT(user?.uiLanguage);
  if (!user) return annotationResponse({ error: t("apiErrors.notLoggedIn") }, 401);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return annotationResponse({ error: t("apiErrors.forbidden") }, 403);
  let text: string | undefined;
  if (kind === "note") {
    const parsed = z.object({ text: z.string().max(2000) }).strict().safeParse(await annotationJson(req, 16384).catch(() => null));
    if (!parsed.success) return annotationResponse({ error: t("apiErrors.invalidInput") }, 400);
    text = parsed.data.text;
  }
  try {
    const row = await legacyVerseAnnotation(user, kind, verseId, text);
    return annotationResponse(kind === "note" ? { note: row && !row.deleted && "text" in row ? row.text : null }
      : kind === "bookmark" ? { bookmarked: !!row && !row.deleted } : { highlighted: !!row && !row.deleted });
  } catch (error) {
    const unavailable = error instanceof AnnotationError && error.code === "UNAVAILABLE";
    return annotationResponse({ error: t(unavailable ? "apiErrors.verseNotFound" : "apiErrors.notSaved") }, unavailable ? 404 : 503);
  }
}
