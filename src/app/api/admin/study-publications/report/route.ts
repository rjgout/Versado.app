import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { studyProgramReview } from "@/lib/studyContent/programReview";
import { programReportJson, programReportMarkdown } from "@/lib/studyContent/programReport";
import { StudyPublishingError } from "@/lib/studyContent/policy";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
const query = z.object({ collectionId: z.string().min(1).max(128), format: z.enum(["md", "json"]).default("md") }).strict();

// Alleen voor beheerders; alleen leesbaar, geen mutatie. Het verslag bevat geen gebruikersgegevens of geheimen.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(),
    t = getT(user?.uiLanguage);
  if (!user) return NextResponse.json({ error: t("apiErrors.notLoggedIn") }, { status: 401, headers });
  if (!user.isAdmin) return NextResponse.json({ error: t("apiErrors.forbidden") }, { status: 403, headers });
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400, headers });
  try {
    const review = await studyProgramReview(user, parsed.data.collectionId);
    const stamp = review.generatedAt.slice(0, 10);
    const base = `controleverslag-${review.collectionId}-${stamp}`.replace(/[^A-Za-z0-9_.-]/g, "_");
    const markdown = parsed.data.format === "md";
    return new NextResponse(markdown ? programReportMarkdown(review) : JSON.stringify(programReportJson(review), null, 2), {
      headers: { ...headers, "Content-Type": markdown ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.${markdown ? "md" : "json"}"` },
    });
  } catch (error) {
    const unavailable = error instanceof StudyPublishingError && error.code === "UNAVAILABLE";
    return NextResponse.json({ error: t(unavailable ? "apiErrors.collectionUnavailable" : "studyPublishing.failed") }, { status: unavailable ? 404 : 503, headers });
  }
}
