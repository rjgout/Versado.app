import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { failureLockSeconds, registerFailure } from "@/lib/rateLimit";
import {
  studyPublishingOverview,
  studyRevisionPreview,
  studyRevisionHistory,
} from "@/lib/studyContent/admin";
import {
  createStudyImport,
  launchStudyImport,
  resumeStudyImport,
} from "@/lib/studyContent/imports";
import {
  publishStudyRevision,
  studyPublicationSchema,
} from "@/lib/studyContent/publication";
import { StudyPublishingError } from "@/lib/studyContent/policy";
import { STUDY_FIXTURES } from "@/lib/studyContent/fixtureAdapter";
import { auditStudyReferences } from "@/lib/references/audit";
import type { MessageKey } from "@/lib/i18n/core";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
};
const id = z.string().min(1).max(128);
const querySchema = z.union([
  z.object({}).strict(),
  z.object({ editionId: id, revisionId: id }).strict(),
  z
    .object({
      editionId: id,
      before: z.coerce.number().int().positive().max(2147483647).optional(),
    })
    .strict(),
]);
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("import"),
      collectionId: id,
      fixtureKey: z.enum(STUDY_FIXTURES),
    })
    .strict(),
  z.object({ action: z.literal("resume"), runId: id }).strict(),
  z.object({action:z.literal("audit-references"),editionId:id,revisionId:id}).strict(),
  studyPublicationSchema.extend({ action: z.literal("publish") }),
]);
async function input(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > 16384)
    throw new StudyPublishingError("INVALID");
  const reader = req.body?.getReader();
  if (!reader) throw new StudyPublishingError("INVALID");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) throw new StudyPublishingError("INVALID");
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(),
    t = getT(user?.uiLanguage);
  if (!user)
    return NextResponse.json(
      { error: t("apiErrors.notLoggedIn") },
      { status: 401, headers },
    );
  if (!user.isAdmin)
    return NextResponse.json(
      { error: t("apiErrors.forbidden") },
      { status: 403, headers },
    );
  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: t("apiErrors.invalidInput") },
      { status: 400, headers },
    );
  try {
    return NextResponse.json(
      "revisionId" in parsed.data
        ? await studyRevisionPreview(
            user,
            parsed.data.editionId,
            parsed.data.revisionId,
          )
        : "editionId" in parsed.data
          ? await studyRevisionHistory(
              user,
              parsed.data.editionId,
              parsed.data.before,
            )
          : await studyPublishingOverview(user),
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: t("studyPublishing.failed") },
      { status: 503, headers },
    );
  }
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(),
    t = getT(user?.uiLanguage);
  const fail = (key: MessageKey, status: number) =>
    NextResponse.json({ error: t(key) }, { status, headers });
  if (!user) return fail("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return fail("apiErrors.forbidden", 403);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL))
    return fail("apiErrors.forbidden", 403);
  const key = `study-publication:${user.id}`;
  if (failureLockSeconds(key, 30))
    return fail("studyPublishing.rateLimited", 429);
  registerFailure(key, 60_000);
  const parsed = actionSchema.safeParse(await input(req).catch(() => null));
  if (!parsed.success) return fail("apiErrors.invalidInput", 400);
  try {
    const action = parsed.data;
    if (action.action === "import") {
      const run = await createStudyImport(
        user,
        action.collectionId,
        action.fixtureKey,
      );
      launchStudyImport(user, run);
      return NextResponse.json({ runId: run.id }, { status: 202, headers });
    }
    if (action.action === "resume") {
      await resumeStudyImport(user, action.runId);
      return NextResponse.json(
        { runId: action.runId },
        { status: 202, headers },
      );
    }
    if(action.action==="audit-references")return NextResponse.json(await auditStudyReferences(user,action.editionId,action.revisionId),{headers});
    const { action: _, ...publication } = action;
    void _;
    return NextResponse.json(await publishStudyRevision(user, publication), {
      headers,
    });
  } catch (error) {
    const code = error instanceof StudyPublishingError ? error.code : "INVALID";
    const status =
      code === "FORBIDDEN"
        ? 403
        : code === "CONFLICT" || code === "BUSY"
          ? 409
          : code === "STORAGE"
            ? 503
            : 400;
    return fail(`studyPublishing.errors.${code}` as MessageKey, status);
  }
}
