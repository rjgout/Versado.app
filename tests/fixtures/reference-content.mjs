import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "../../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../../src/lib/auth.ts";
import {
  createStudyImport,
  executeStudyImport,
} from "../../src/lib/studyContent/imports.ts";
import { publishStudyRevision } from "../../src/lib/studyContent/publication.ts";
import { getStudyReader } from "../../src/lib/studyContent/reader.ts";
export function assertReferenceTestEnvironment() {
  const db = new URL(
      process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
    ),
    base = new URL(
      process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid",
    );
  if (
    db.hostname !== "127.0.0.1" ||
    db.pathname !== "/versado_content_access_test" ||
    process.env.DATABASE_URL !== db.href ||
    base.hostname !== "127.0.0.1"
  )
    throw Error("Eigen geïsoleerde PostgreSQL vereist");
  return base.origin;
}
export async function referenceAccount(isAdmin = false, uiLanguage = "nl") {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@reference-fixture.invalid`,
      handle: `R${randomUUID().slice(0, 8)}`,
      discriminator: "00",
      passwordHash: "isolated-only",
      uiLanguage,
      isAdmin,
      timeZone: "UTC",
      hintBalance: 8,
      xpTotal: 42,
    },
  });
  const token = await createSessionToken(user.id);
  return {
    user,
    token,
    cookie: `${SESSION_COOKIE}=${token}`,
    sessionKey: createHash("sha256").update(token).digest("hex"),
    actor: { id: user.id, isAdmin },
  };
}
export async function ensureReferenceScripture() {
  assertReferenceTestEnvironment();
  const existing = await prisma.chapter.findFirst({
    where: {
      number: 1,
      book: { key: "bofm/1-ne", contentCollectionId: "content_bom" },
    },
  });
  if (existing) return existing;
  const book = await prisma.book.create({
    data: {
      slug: `reference-scripture-${randomUUID()}`,
      key: "bofm/1-ne",
      name: "1 Nephi",
      order: 1,
      contentCollectionId: "content_bom",
    },
  });
  const texts = JSON.parse(readFileSync("prisma/bomContent.json", "utf8"))[0]
    .chapters[0].verses;
  return prisma.chapter.create({
    data: {
      bookId: book.id,
      number: 1,
      order: 1,
      verses: { create: texts.map((text, i) => ({ number: i + 1, text })) },
    },
  });
}
export async function referenceFixture(language = "nl") {
  const base = assertReferenceTestEnvironment();
  await ensureReferenceScripture();
  const admin = await referenceAccount(true),
    owner = await referenceAccount(false, language);
  const key = `synthetic-study-reference-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  const collection = await prisma.contentCollection.create({
    data: {
      id: key,
      slug: key,
      name: "Synthetische verwijzingsles",
      icon: "",
      work: key,
      editionKey: "fixture-v1",
      language: "nl",
      visibleToUsers: true,
      publicationState: "PUBLISHED",
    },
  });
  await prisma.user.update({
    where: { id: owner.user.id },
    data: { activeContentCollectionId: key, contentLanguage: "nl" },
  });
  const publish = async (fixture) => {
    const run = await createStudyImport(admin.actor, key, fixture);
    await executeStudyImport(admin.actor, run.id);
    const item = await prisma.contentImportItem.findFirstOrThrow({
      where: { runId: run.id },
      include: { edition: true },
    });
    await publishStudyRevision(admin.actor, {
      editionId: item.lessonEditionId,
      revisionId: item.revisionId,
      importRunId: run.id,
      kind: "PUBLISH",
      expectedVersion: item.edition.publicationVersion,
      actionId: randomUUID(),
    });
    return item;
  };
  const item = await publish("references");
  const dto = await getStudyReader(
    owner.actor,
    item.edition.lessonId,
    key,
    owner.sessionKey,
  );
  const request = {
    lessonEditionId: item.lessonEditionId,
    revisionId: item.revisionId,
    occurrenceKey: "reference-intro",
    visitProof: dto.visitProof,
  };
  return {
    base,
    admin,
    owner,
    collection,
    item,
    dto,
    request,
    publish,
    href: `/study-lesson/${item.edition.lessonId}/${key}`,
  };
}
export async function referenceHttp(f, body, who = f.owner, origin = f.base) {
  return fetch(`${f.base}/api/study-references`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(who
        ? { Cookie: who.cookie, "X-Reading-Session": who.sessionKey }
        : {}),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}
