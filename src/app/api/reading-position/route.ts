import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import {
  getReadingPosition,
  saveReadingPosition,
  ReadingPositionError,
} from "@/lib/studyContent/readingPosition";
import { readingPositionActionSchema } from "@/lib/studyContent/readingPositionContract";
export const runtime = "nodejs";
const query = z
  .object({ lessonEditionId: z.string().min(1).max(128) })
  .strict();
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  });
async function boundedJson(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader || Number(req.headers.get("content-length") ?? 0) > 4096)
    return null;
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 4096) return null;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
async function handle(req: NextRequest, write: boolean) {
  const user = await getCurrentUser();
  const t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  if (
    write &&
    req.headers.get("X-Reading-Session") !== (await navigationSessionKey())
  )
    return response({ error: t("apiErrors.forbidden") }, 403);
  if (
    write &&
    !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)
  )
    return response({ error: t("apiErrors.forbidden") }, 403);
  try {
    if (!write) {
      const parsed = query.safeParse(
        Object.fromEntries(req.nextUrl.searchParams),
      );
      if (
        !parsed.success ||
        [...req.nextUrl.searchParams.keys()].length !==
          new Set(req.nextUrl.searchParams.keys()).size
      )
        return response({ error: t("apiErrors.invalidInput") }, 400);
      return response(
        await getReadingPosition(user, parsed.data.lessonEditionId),
      );
    }
    const parsed = readingPositionActionSchema.safeParse(
      await boundedJson(req).catch(() => null),
    );
    if (!parsed.success)
      return response({ error: t("apiErrors.invalidInput") }, 400);
    return response(await saveReadingPosition(user, parsed.data));
  } catch (error) {
    if (error instanceof ReadingPositionError) {
      if (error.code === "CONFLICT")
        return response(
          {
            code: error.code,
            error: t("apiErrors.notSaved"),
            state: error.state,
          },
          409,
        );
      return response(
        {
          code: error.code,
          error: t(
            error.code === "INVALID"
              ? "apiErrors.invalidInput"
              : "apiErrors.collectionUnavailable",
          ),
        },
        error.code === "INVALID" ? 400 : 404,
      );
    }
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
export const GET = (req: NextRequest) => handle(req, false);
export const PUT = (req: NextRequest) => handle(req, true);
