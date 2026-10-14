import type {
  Prisma,
  PrismaClient,
  ReadingPosition,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import {
  getPublishedStudyLesson,
  validateStudyRevision,
  studyRevisionHash,
  type StudyRevisionInput,
} from "./revisions";
import { studyObjectHash } from "./policy";
import { validReadingVisitProof } from "./readingVisitProof";
import {
  readingPositionActionSchema,
  readingBlock,
  readingQuote,
  readingStart,
  sameReadingCoordinate,
  type ReadingPositionAction,
  type ReadingPositionState,
  type ReadingPositionView,
  type ReaderDocument,
} from "./readingPositionContract";

type Actor = { id: string; isAdmin: boolean };
export class ReadingPositionError extends Error {
  constructor(
    readonly code: "UNAVAILABLE" | "INVALID" | "CONFLICT",
    readonly state?: ReadingPositionState,
  ) {
    super(code);
  }
}
function view(row: ReadingPosition | null): ReadingPositionView | null {
  if (!row) return null;
  return {
    lessonEditionId: row.lessonEditionId,
    revisionId: row.revisionId,
    sectionAnchor: row.sectionAnchor,
    blockAnchor: row.blockAnchor,
    sectionFraction: row.sectionFraction,
    quoteContext: row.quoteContext,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    lastActionId: row.lastActionId,
  };
}
async function authorizedEdition(
  db: Prisma.TransactionClient,
  actor: Actor,
  editionId: string,
) {
  const edition = await db.studyLessonEdition.findUnique({
    where: { id: editionId },
    select: { lessonId: true, collectionId: true, publicationVersion: true },
  });
  const current =
    edition &&
    (await getPublishedStudyLesson(
      actor,
      edition.lessonId,
      edition.collectionId,
      db,
    ));
  if (!current || current.editionId !== editionId)
    throw new ReadingPositionError("UNAVAILABLE");
  return { current, publicationVersion: edition.publicationVersion };
}
async function state(
  db: Prisma.TransactionClient,
  actor: Actor,
  editionId: string,
) {
  const authorized = await authorizedEdition(db, actor, editionId);
  const row = await db.readingPosition.findUnique({
    where: {
      userId_lessonEditionId: { userId: actor.id, lessonEditionId: editionId },
    },
  });
  return {
    authorized,
    row,
    state: {
      lessonEditionId: editionId,
      currentRevisionId: authorized.current.revisionId,
      publicationVersion: authorized.publicationVersion,
      position: view(row),
    } satisfies ReadingPositionState,
  };
}
export async function getReadingPosition(
  actor: Actor,
  editionId: string,
  client: PrismaClient = prisma,
): Promise<ReadingPositionState> {
  return client.$transaction(
    async (db) => {
      await db.$executeRaw`SET TRANSACTION READ ONLY`;
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      return (await state(db, actor, editionId)).state;
    },
    { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 },
  );
}
async function authorizedRevision(
  db: Prisma.TransactionClient,
  editionId: string,
  revisionId: string,
  current: { revisionId: string; body: ReaderDocument },
  actorId: string,
  sessionKey: string | undefined,
  visitProof: string | undefined,
): Promise<ReaderDocument> {
  if (revisionId === current.revisionId) return current.body;
  if (!validReadingVisitProof(visitProof, actorId, editionId, revisionId, sessionKey))
    throw new ReadingPositionError("UNAVAILABLE");
  const historical = await db.studyPublicationAction.findFirst({
    where: {
      lessonEditionId: editionId,
      OR: [{ revisionId }, { previousRevisionId: revisionId }],
    },
    select: { id: true },
  });
  if (!historical) throw new ReadingPositionError("UNAVAILABLE");
  const r = await db.studyRevision.findUnique({
    where: {
      id_lessonEditionId: { id: revisionId, lessonEditionId: editionId },
    },
  });
  if (!r) throw new ReadingPositionError("UNAVAILABLE");
  try {
    const value = validateStudyRevision({
      schemaVersion: r.schemaVersion as 1,
      title: r.title,
      body: r.body,
      sourceMetadata: r.sourceMetadata as StudyRevisionInput["sourceMetadata"],
      rightsMetadata: r.rightsMetadata as StudyRevisionInput["rightsMetadata"],
    });
    if (studyRevisionHash(value) !== r.contentHash) throw new Error("hash");
    return value.body;
  } catch {
    throw new ReadingPositionError("UNAVAILABLE");
  }
}
export async function saveReadingPosition(
  actor: Actor,
  input: ReadingPositionAction,
  client: PrismaClient = prisma,
  sessionKey?: string,
) {
  const parsed = readingPositionActionSchema.safeParse(input);
  if (!parsed.success) throw new ReadingPositionError("INVALID");
  const action = parsed.data;
  const hash = studyObjectHash(action);
  const result = await client.$transaction(
    async (db) => {
      await db.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      // Publicatie bewaakt dezelfde editie met FOR UPDATE. SHARE laat verschillende
      // lezers gelijktijdig opslaan, maar sluit een pointerwissel tijdens deze save uit.
      await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${action.lessonEditionId} FOR SHARE`;
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, action.lessonEditionId])},0))`;
      const current = await state(db, actor, action.lessonEditionId);
      if (current.row?.lastActionId === action.actionId) {
        if (current.row.lastActionHash !== hash)
          throw new ReadingPositionError("INVALID");
        return { changed: false, state: current.state };
      }
      if ((current.row?.version ?? 0) !== action.expectedVersion)
        throw new ReadingPositionError("CONFLICT", current.state);
      const document = await authorizedRevision(
        db,
        action.lessonEditionId,
        action.revisionId,
        current.authorized.current,
        actor.id,
        sessionKey,
        action.visitProof,
      );
      const block = readingBlock(
        document,
        action.sectionAnchor,
        action.blockAnchor,
      );
      if (!block) throw new ReadingPositionError("INVALID");
      if (
        action.intent === "START_OVER" &&
        !sameReadingCoordinate(
          action,
          readingStart(document, action.revisionId),
        )
      )
        throw new ReadingPositionError("INVALID");
      if (
        action.intent === "SAVE" &&
        sameReadingCoordinate(action, current.state.position)
      )
        return { changed: false, state: current.state };
      const data = {
        revisionId: action.revisionId,
        sectionAnchor: action.sectionAnchor,
        blockAnchor: action.blockAnchor,
        sectionFraction: action.sectionFraction,
        quoteContext: readingQuote(block),
        version: action.expectedVersion + 1,
        lastActionId: action.actionId,
        lastActionHash: hash,
      };
      const where = {
        userId_lessonEditionId: {
          userId: actor.id,
          lessonEditionId: action.lessonEditionId,
        },
      };
      const saved = current.row
        ? await db.readingPosition.update({ where, data })
        : await db.readingPosition.create({
            data: {
              userId: actor.id,
              lessonEditionId: action.lessonEditionId,
              ...data,
            },
          });
      return {
        changed: true,
        state: { ...current.state, position: view(saved) },
      };
    },
    { maxWait: 5000, timeout: 10000 },
  );
  // Alleen eigen positie; nooit progressie/economie of persoonlijke socketpayload.
  if (result.changed)
    emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, {
      event: "readingPositionChanged",
    });
  return result;
}
