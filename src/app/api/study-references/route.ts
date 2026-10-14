import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { contentSelectionSchema } from "@/lib/contentPickerContract";
import { referenceRequestSchema } from "@/lib/references/contract";
import { resolveStudyReference } from "@/lib/references/resolver";
import {
  moreReference,
  returnReference,
  ReferenceTripConflict,
  ContentSelectionConflict,
} from "@/lib/references/trip";
import { getT } from "@/lib/i18n";
export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  referenceRequestSchema.extend({ action: z.literal("preview") }),
  referenceRequestSchema.extend({
    action: z.literal("more"),
    expectedSelection: contentSelectionSchema,
    expectedSelectionVersion: z.number().int().nonnegative().max(2147483647),
    expectedPositionVersion: z.number().int().nonnegative().max(2147483647),
  }),
  z
    .object({ action: z.literal("return"), token: z.string().min(1).max(6000) })
    .strict(),
]);
const headers = {
  "Cache-Control": "no-store, private",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}
async function boundedInput(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) return null;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(),
    t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  const sessionKey = await navigationSessionKey();
  if (
    !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL) ||
    req.headers.get("X-Reading-Session") !== sessionKey
  )
    return response({ error: t("apiErrors.forbidden") }, 403);
  const parsed = schema.safeParse(await boundedInput(req).catch(() => null));
  if (!parsed.success)
    return response({ error: t("apiErrors.invalidInput") }, 400);
  const { action, ...data } = parsed.data;
  try {
    if (action === "return" && "token" in data)
      return response(await returnReference(user, data.token, sessionKey));
    if (action === "more" && "expectedSelection" in data) {
      const {
        expectedSelection,
        expectedPositionVersion,
        expectedSelectionVersion,
        ...request
      } = data;
      return response(
        await moreReference(
          user,
          request,
          sessionKey,
          expectedSelection,
          expectedPositionVersion,
          expectedSelectionVersion,
        ),
      );
    }
    if (action === "preview" && "occurrenceKey" in data)
      return response(await resolveStudyReference(user, data, sessionKey));
    return response({ error: t("apiErrors.invalidInput") }, 400);
  } catch (error) {
    if (
      error instanceof ReferenceTripConflict ||
      error instanceof ContentSelectionConflict
    )
      return response(
        { code: "REFERENCE_CONFLICT", error: t("apiErrors.notSaved") },
        409,
      );
    const unavailable =
      error instanceof Error &&
      ["REFERENCE_UNAVAILABLE", "UNAVAILABLE", "NOT_FOUND", "Content niet beschikbaar"].includes(
        error.message,
      );
    return response(
      {
        error: t(
          unavailable
            ? "apiErrors.collectionUnavailable"
            : "apiErrors.notSaved",
        ),
      },
      unavailable ? 404 : 503,
    );
  }
}
