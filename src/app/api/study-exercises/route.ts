import { validReadingVisitProof } from "@/lib/studyContent/readingVisitProof";
import { pilotReadingSelections } from "@/lib/studyContent/pilotReadings";
import type { ExerciseLesson } from "@/lib/studyContent/exercisePlan";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import {
  issueStudyExerciseSession,
  resumeStudyExerciseSession,
  submitStudyExerciseSession,
  ExerciseSessionError,
} from "@/lib/learning/contentProgress";
import {
  loadStudyExerciseSource,
  studyExerciseContextSchema,
} from "@/lib/studyContent/exerciseSource";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { notifyNewAchievements } from "@/lib/notify";
const id = z.string().min(1).max(128);
const visitProof = z.string().max(1500).optional();
class ReadingVisitRequired extends Error {}
function assertReadingOffered(
  actorId: string,
  sessionKey: string,
  source: {
    lesson: ExerciseLesson & { revisionId: string };
    plan: { fingerprint: string };
  },
  stepIndex: number | null,
  proof: string | undefined,
) {
  if (
    pilotReadingSelections(source.lesson).length &&
    !validReadingVisitProof(
      proof,
      actorId,
      source.lesson.editionId,
      `${source.lesson.revisionId}:${source.plan.fingerprint}:${stepIndex ?? "week"}`,
      sessionKey,
    )
  )
    throw new ReadingVisitRequired();
}
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("resume"),
      visitProof,
      sessionId: id,
      editionId: id,
      revisionId: id,
      stepIndex: z.number().int().min(1).max(6).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("issue"),
      visitProof,
      editionId: id,
      revisionId: id,
      stepIndex: z.number().int().min(1).max(6).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("check"),
      visitProof,
      sessionId: id,
      exerciseId: id,
      given: z.array(z.string().max(2000)).min(1).max(30),
    })
    .strict(),
  z
    .object({
      action: z.literal("submit"),
      visitProof,
      sessionId: id,
      answers: z
        .array(
          z
            .object({
              exerciseId: id,
              given: z.array(z.string().max(2000)).min(1).max(30),
            })
            .strict(),
        )
        .min(1)
        .max(18),
    })
    .strict(),
]);
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function POST(req: NextRequest) {
  const actor = await getCurrentUser(),
    t = getT(actor?.uiLanguage);
  if (!actor) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  const sessionKey = await navigationSessionKey();
  if (
    req.headers.get("X-Reading-Session") !== sessionKey ||
    !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)
  )
    return response({ error: t("apiErrors.forbidden") }, 403);
  const raw = await req.text().catch(() => "");
  if (raw.length > 40_000)
    return response({ error: t("apiErrors.invalidInput") }, 400);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return response({ error: t("apiErrors.invalidInput") }, 400);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return response({ error: t("apiErrors.invalidInput") }, 400);
  try {
    const input = parsed.data;
    if (input.action === "issue" || input.action === "resume") {
      const source = await loadStudyExerciseSource(
        actor,
        input.editionId,
        prisma,
      );
      if (source)
        assertReadingOffered(
          actor.id,
          sessionKey,
          source,
          input.stepIndex,
          input.visitProof,
        );
    } else if (input.action === "submit") {
      const session = await prisma.exerciseSession.findFirst({
        where: { id: input.sessionId, userId: actor.id },
      });
      const context = studyExerciseContextSchema.safeParse(
        session?.studyContext,
      );
      if (context.success) {
        const source = await loadStudyExerciseSource(
          actor,
          context.data.editionId,
          prisma,
        );
        if (source)
          assertReadingOffered(
            actor.id,
            sessionKey,
            source,
            context.data.stepIndex,
            input.visitProof,
          );
      }
    }
    if (input.action === "issue")
      return response(await issueStudyExerciseSession(actor, input));
    if (input.action === "resume")
      return response(await resumeStudyExerciseSession(actor, input));
    if (input.action === "submit") {
      const result = await submitStudyExerciseSession(
        actor,
        input.sessionId,
        input.answers,
      );
      if (!result.replayed)
        notifyNewAchievements(actor.id, result.newAchievements).catch(() => {});
      return response(result);
    }
    const session = await prisma.exerciseSession.findFirst({
      where: { id: input.sessionId, userId: actor.id },
    });
    const context = studyExerciseContextSchema.safeParse(session?.studyContext);
    if (
      !session ||
      !context.success ||
      !JSON.parse(session.exerciseIds).includes(input.exerciseId)
    )
      throw new ExerciseSessionError("NOT_FOUND");
    const source = await loadStudyExerciseSource(
      actor,
      context.data.editionId,
      prisma,
    );
    if (
      !source ||
      source.lesson.revisionId !== context.data.revisionId ||
      source.plan.fingerprint !== context.data.fingerprint
    )
      throw new ExerciseSessionError("LOCKED");
    assertReadingOffered(
      actor.id,
      sessionKey,
      source,
      context.data.stepIndex,
      input.visitProof,
    );
    const question = source.plan.parts
      .flatMap((p) => p.questions)
      .find((q) => q.id === input.exerciseId);
    if (!question) throw new ExerciseSessionError("NOT_FOUND");
    return response({
      correct: isExerciseCorrect(question.type, input.given, question.answers),
      correctAnswer: question.answers,
    });
  } catch (error) {
    if (error instanceof ReadingVisitRequired)
      return response(
        { error: t("cfmExercises.readFirst"), code: "READ_REQUIRED" },
        409,
      );
    if (error instanceof ExerciseSessionError)
      return response(
        {
          error: t(
            error.code === "INCOMPLETE"
              ? "apiErrors.exercisesIncomplete"
              : "apiErrors.collectionUnavailable",
          ),
        },
        error.code === "INCOMPLETE"
          ? 400
          : error.code === "NOT_FOUND"
            ? 404
            : 409,
      );
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
