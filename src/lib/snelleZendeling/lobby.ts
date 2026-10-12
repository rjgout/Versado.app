import { customAlphabet } from "nanoid";
import { prisma } from "@/lib/db";
import { getContentAvailability } from "@/lib/contentAccess";
import { requireQuickMissionarySource } from "./source";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

export async function createQuickMissionaryLobby(userId: string): Promise<{ code: string }> {
  return prisma.$transaction(async tx => {
    const contentCollectionId = await requireQuickMissionarySource(userId, tx);
    let code = generateCode();
    for (let attempt = 0; attempt < 5 && await tx.liveGame.findUnique({ where: { code }, select: { id: true } }); attempt++) code = generateCode();
    await tx.liveGame.create({ data: { code, hostId: userId, mode: "QUICK_MISSIONARY", status: "LOBBY", players: { create: { userId, contentCollectionId } } } });
    return { code };
  });
}

/** Zelfde lobbylock als startMatch: deelname en start zien één deelnemerslijst. */
export async function joinQuickMissionaryLobby(code: string, userId: string, confirmSource = false): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "LiveGame" WHERE "code" = ${code} FOR UPDATE`;
    const game = await tx.liveGame.findUnique({ where: { code }, select: { id: true, mode: true, status: true, hostId: true } });
    if (!game || game.mode !== "QUICK_MISSIONARY") throw new Error("NOT_FOUND");
    const player = await tx.liveGamePlayer.findUnique({ where: { gameId_userId: { gameId: game.id, userId } } });
    if (player) {
      if (player.contentCollectionId) {
        if (!(await getContentAvailability({ isAdmin: false }, player.contentCollectionId, "read", tx))) throw new Error("SOURCE_UNAVAILABLE");
        return; // Reconnect verandert nooit een bestaande snapshot of economie.
      }
      if (!confirmSource || game.status !== "LOBBY") return; // Oud lid ziet veilige metadata/afronding, geen nieuwe startbron.
      const contentCollectionId = await requireQuickMissionarySource(userId, tx);
      await tx.liveGamePlayer.update({ where: { id: player.id }, data: { contentCollectionId } });
      return;
    }
    if (game.status !== "LOBBY") throw new Error("NOT_PARTICIPANT");
    if (game.hostId !== userId && !await tx.liveGameInvite.findUnique({ where: { gameId_userId: { gameId: game.id, userId } } })) throw new Error("NOT_INVITED");
    const contentCollectionId = await requireQuickMissionarySource(userId, tx);
    await tx.liveGamePlayer.create({ data: { gameId: game.id, userId, contentCollectionId } });
  });
}

export async function leaveQuickMissionaryLobby(gameId: string, userId: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "LiveGame" WHERE "id" = ${gameId} FOR UPDATE`;
    const game = await tx.liveGame.findUnique({ where: { id: gameId }, select: { status: true, hostId: true } });
    if (!game || game.status !== "LOBBY" || game.hostId === userId) return false;
    await tx.liveGamePlayer.deleteMany({ where: { gameId, userId } });
    return true;
  });
}
