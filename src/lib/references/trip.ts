import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  commitContentSelection,
  restoreContentSelection,
  type ContentCollectionView,
  ContentSelectionConflict,
} from "@/lib/contentCollections";
import {
  contentSelectionSchema,
  type ContentSelection,
} from "@/lib/contentPickerContract";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getPublishedStudyLesson } from "@/lib/studyContent/revisions";

import { originHref, type OriginView } from "./originView";
import { referenceRequestSchema, type ReferenceRequest } from "./contract";
import { referenceInTransaction, type ReferenceActor } from "./resolver";
import {
  referenceTripSchema,
  REFERENCE_TRIP_TTL_MS,
  type ReferenceTrip,
} from "./tripContract";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
export class ReferenceTripConflict extends Error {
  constructor() {
    super("REFERENCE_TRIP_CONFLICT");
  }
}
function signature(raw: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16)
    throw new Error("REFERENCE_SIGNING_UNAVAILABLE");
  const key = createHmac("sha256", secret)
    .update("versado:reference-trip:v1")
    .digest();
  return createHmac("sha256", key).update(raw).digest();
}
export function sealReferenceTrip(trip: ReferenceTrip) {
  const data = Buffer.from(
    JSON.stringify(referenceTripSchema.parse(trip)),
  ).toString("base64url");
  return `${data}.${signature(data).toString("base64url")}`;
}
export function openReferenceTrip(
  token: string,
  userId: string,
  sessionKey: string,
  now = Date.now(),
): ReferenceTrip | null {
  if (token.length > 6000) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const data = Buffer.from(parts[0], "base64url"),
      supplied = Buffer.from(parts[1], "base64url");
    if (
      data.toString("base64url") !== parts[0] ||
      supplied.toString("base64url") !== parts[1]
    )
      return null;
    const expected = signature(parts[0]);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return null;
    const trip = referenceTripSchema.parse(JSON.parse(data.toString("utf8")));
    return trip.userId === userId &&
      trip.sessionKey === sessionKey &&
      trip.issuedAt <= now + 60000 &&
      trip.expiresAt > now &&
      trip.expiresAt - trip.issuedAt === REFERENCE_TRIP_TTL_MS
      ? trip
      : null;
  } catch {
    return null;
  }
}
export async function moreReference(
  actor: ReferenceActor,
  raw: ReferenceRequest,
  sessionKey: string,
  expected: ContentSelection,
  expectedPositionVersion: number,
  expectedSelectionVersion: number,
  originView?: OriginView,
) {
  const input = referenceRequestSchema.parse(raw),
    before = contentSelectionSchema.parse(expected);
  const saved = await prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      await db.$executeRaw`SET LOCAL lock_timeout='3s'`;
      // Zelfde volgorde als lezen: editie → studiecontext → leespositie → User.
      await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${input.lessonEditionId} FOR SHARE`;
      const { origin, result } = await referenceInTransaction(
        db,
        actor,
        input,
        sessionKey,
      );
      if (result.kind !== "internal") throw new Error("REFERENCE_UNAVAILABLE");
      const targetStudyWorkKey =
        result.preview.kind === "study" ? result.work : null;
      for (const work of [
        ...new Set([
          origin.workKey,
          ...(targetStudyWorkKey ? [targetStudyWorkKey] : []),
        ]),
      ].sort())
        await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, work])},0))`;
      await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, origin.editionId])},0))`;
      const position = await db.readingPosition.findUnique({
        where: {
          userId_lessonEditionId: {
            userId: actor.id,
            lessonEditionId: origin.editionId,
          },
        },
      });
      if ((position?.version ?? 0) !== expectedPositionVersion)
        throw new ReferenceTripConflict();
      const context = await db.userStudyContext.findUnique({
        where: {
          userId_workKey: { userId: actor.id, workKey: origin.workKey },
        },
        select: { version: true },
      });
      const targetContext = targetStudyWorkKey
        ? await db.userStudyContext.findUnique({
            where: {
              userId_workKey: { userId: actor.id, workKey: targetStudyWorkKey },
            },
            select: { version: true },
          })
        : null;
      const target = await db.contentCollection.findFirst({
        where: { id: result.collectionId, ...readingAccessWhere(actor) },
      });
      if (!target) throw new Error("REFERENCE_UNAVAILABLE");
      const now = Date.now(),
        key = randomUUID();
      const trip: ReferenceTrip = {
        purpose: "reference-trip-v1",
        key,
        userId: actor.id,
        sessionKey,
        issuedAt: now,
        expiresAt: now + REFERENCE_TRIP_TTL_MS,
        lessonId: origin.lessonId,
        lessonEditionId: origin.editionId,
        collectionId: origin.collectionId,
        revisionId: input.revisionId,
        sectionAnchor: position?.sectionAnchor ?? null,
        blockAnchor: position?.blockAnchor ?? null,
        positionVersion: expectedPositionVersion,
        workKey: origin.workKey,
        studyVersion: context?.version ?? 0,
        targetStudyWorkKey,
        targetStudyVersion: targetStudyWorkKey
          ? (targetContext?.version ?? 0)
          : null,
        before,
        after: {
          activeContentCollectionId: target.id,
          contentLanguage: target.language,
        },
        beforeVersion: expectedSelectionVersion,
        afterVersion: expectedSelectionVersion,
        originHref: originHref(origin.lessonId, origin.collectionId, originView),
        targetHref: result.href,
      };
      sealReferenceTrip(trip); // Configuratie en routes vóór de voorkeurmutatie valideren.
      const selection = await commitContentSelection(
        actor.id,
        actor.isAdmin,
        target as ContentCollectionView,
        before,
        { db, expectedVersion: expectedSelectionVersion },
      );
      trip.after = selection.selection;
      trip.afterVersion = selection.selectionVersion;
      const token = sealReferenceTrip(trip);
      const url = new URL(result.href, "https://local.invalid");
      url.searchParams.set("returnKey", key);
      return {
        changed: selection.changed,
        href: `${url.pathname}${url.search}${url.hash}`,
        token,
        trip,
      };
    },
    { timeout: 10000 },
  );
  if (saved.changed)
    emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, { event: "contentChanged" });
  const { changed: _, ...response } = saved;
  void _;
  return response;
}
export async function returnReference(
  actor: ReferenceActor,
  token: string,
  sessionKey: string,
) {
  const trip = openReferenceTrip(token, actor.id, sessionKey);
  if (!trip) throw new Error("REFERENCE_UNAVAILABLE");
  const saved = await prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      await db.$executeRaw`SET LOCAL lock_timeout='3s'`;
      await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${trip.lessonEditionId} FOR SHARE`;
      const origin = await getPublishedStudyLesson(
        actor,
        trip.lessonId,
        trip.collectionId,
        db,
      );
      if (!origin || origin.editionId !== trip.lessonEditionId)
        throw new Error("REFERENCE_UNAVAILABLE");
      for (const work of [
        ...new Set([
          trip.workKey,
          ...(trip.targetStudyWorkKey ? [trip.targetStudyWorkKey] : []),
        ]),
      ].sort())
        await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, work])},0))`;
      const context = await db.userStudyContext.findUnique({
        where: { userId_workKey: { userId: actor.id, workKey: trip.workKey } },
        select: { version: true },
      });
      if ((context?.version ?? 0) !== trip.studyVersion)
        throw new ReferenceTripConflict();
      if (trip.targetStudyWorkKey) {
        const targetContext = await db.userStudyContext.findUnique({
          where: {
            userId_workKey: {
              userId: actor.id,
              workKey: trip.targetStudyWorkKey,
            },
          },
          select: { version: true },
        });
        if ((targetContext?.version ?? 0) !== trip.targetStudyVersion)
          throw new ReferenceTripConflict();
      }
      await db.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
      const current = await db.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: {
          contentSelectionVersion: true,
          activeContentCollectionId: true,
          contentLanguage: true,
        },
      });
      // Een verloren terugkeerresponse kan uitsluitend als no-op worden herkend.
      // De herhaalde actie schrijft nooit opnieuw en accepteert geen latere ABA.
      if (
        current.contentSelectionVersion === trip.afterVersion + 1 &&
        current.activeContentCollectionId ===
          trip.before.activeContentCollectionId &&
        current.contentLanguage === trip.before.contentLanguage
      )
        return { changed: false };
      return restoreContentSelection(
        actor.id,
        actor.isAdmin,
        trip.before,
        trip.after,
        { db, expectedVersion: trip.afterVersion },
      );
    },
    { timeout: 10000 },
  );
  if (saved.changed)
    emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, { event: "contentChanged" });
  return { href: trip.originHref };
}
export { ContentSelectionConflict };
