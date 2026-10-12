import type { Prisma } from "../../src/generated/prisma/client";

/** Alleen aangeroepen door tests op hun eigen wegwerpdatabase; geen seed/import. */
export async function quickMissionaryFixture(db: Prisma.TransactionClient, id = "content_bom", language = "nl") {
  await db.contentWork.upsert({ where: { key: "bofm" }, create: { key: "bofm", kind: "SCRIPTURE" }, update: {} });
  await db.contentCollection.upsert({ where: { id }, create: { id, slug: id, name: `Synthetisch ${language}`, icon: "book", work: "bofm", editionKey: "bofm", language, enabled: true, visibleToUsers: true, publicationState: "LEGACY" }, update: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
  if (id !== "content_bom") await quickMissionaryFixture(db);
  await db.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", quickMissionaryEnabled: true }, update: { quickMissionaryEnabled: true } });
  await db.gameContentScope.upsert({ where: { gameKey_contentCollectionId: { gameKey: "quick-missionary", contentCollectionId: id } }, create: { gameKey: "quick-missionary", contentCollectionId: id }, update: {} });
}
