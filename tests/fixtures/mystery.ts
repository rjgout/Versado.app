import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { MYSTERY_GAME } from "../../src/lib/mysteries/game";
import { createSessionToken, SESSION_COOKIE } from "../../src/lib/auth";

export async function mysteryFixture() {
  await prisma.contentWork.upsert({ where: { key: "bofm" }, create: { key: "bofm", kind: "SCRIPTURE" }, update: {} });
  for (const [id,language] of [["content_bom","nl"],["content_bom_en","en"]]) {
    await prisma.contentCollection.upsert({ where: { id }, create: { id, slug: id, name: `Test ${language}`, icon: "", work: "bofm", editionKey: "bofm", language, enabled: true, visibleToUsers: true, publicationState: "LEGACY" }, update: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
    await prisma.gameContentScope.upsert({ where: { gameKey_contentCollectionId: { gameKey: "mystery", contentCollectionId: id } }, create: { gameKey: "mystery", contentCollectionId: id }, update: {} });
    for (const d of MYSTERY_GAME.puzzles) {
      let book = await prisma.book.findFirst({ where: { contentCollectionId: id, key: d.story.source.bookKey } });
      book ??= await prisma.book.create({ data: { contentCollectionId: id, key: d.story.source.bookKey, slug: `mystery-${randomUUID()}`, name: "Synthetisch schriftboek", order: 1 } });
      if (!await prisma.chapter.findFirst({ where: { bookId: book.id, number: d.story.source.chapterStart } })) await prisma.chapter.create({ data: { bookId: book.id, number: d.story.source.chapterStart, order: d.story.source.chapterStart, verses: { create: { number: 1, text: `Synthetische tekst ${language}` } } } });
    }
  }
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { mysteryEnabled: true }, update: { mysteryEnabled: true } });
}
export async function mysteryAccount(source = "content_bom", admin = false, unlocked = false) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@mystery.test.invalid`, handle: `M${randomUUID().slice(0,10)}`, discriminator: "00", passwordHash: "synthetic", activeContentCollectionId: source, isAdmin: admin, hintBalance: 8, xpTotal: 100, uiLanguage: "nl", contentLanguage: source.endsWith("en") ? "en" : "nl", timeZone: "UTC", onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), kompasOffersEnabled: false } });
  if (unlocked) for (const mystery of MYSTERY_GAME.mysteries.slice(0,5)) await prisma.mysteryProgress.create({ data: { userId: user.id, mysteryId: mystery.id, difficulty: "DISCOVERER", completed: true, completedAt: new Date(), hintCount: 7, tutorialSeenAt: new Date() } });
  return { id: user.id, cookie: `${SESSION_COOKIE}=${await createSessionToken(user.id)}`, token: await createSessionToken(user.id) };
}
