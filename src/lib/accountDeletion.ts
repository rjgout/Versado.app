import { prisma } from "./db";
import { leaveAllGroups } from "./social/groups";
import { disconnectUserSockets } from "./realtime";

/** Dezelfde wisprocedure voor zelf wissen, beheer en periodieke opschoning. */
export async function deleteUserAccount(userId: string): Promise<void> {
  await leaveAllGroups(userId);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return;
    await tx.pendingRegistration.deleteMany({ where: { email: user.email } });
    await tx.user.delete({ where: { id: userId } });
  });
  disconnectUserSockets(userId);
}
