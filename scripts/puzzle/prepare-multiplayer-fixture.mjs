// Minimale toegestane spelbron in de eigen runner; geen algemene seed/import.
import { prisma } from "../../src/lib/db.ts";
const url = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== url.href) throw new Error("Alleen de eigen puzzeltestdatabase");
try {
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
  await prisma.gameContentScope.upsert({ where: { gameKey_contentCollectionId: { gameKey: "jigsaw", contentCollectionId: "content_bom" } }, create: { gameKey: "jigsaw", contentCollectionId: "content_bom" }, update: {} });
} finally { await prisma.$disconnect(); }
