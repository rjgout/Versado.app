import "server-only";
import { prisma } from "@/lib/db";
import { collectInventory, READ_ONLY_SQL, TIMEOUT_SQL, LOCK_TIMEOUT_SQL } from "./core";

/** Bestaande Prisma-pool; instellingen blijven beperkt tot deze ene transactie. */
export async function runContentInventory() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(READ_ONLY_SQL);
    await tx.$executeRawUnsafe(TIMEOUT_SQL);
    await tx.$executeRawUnsafe(LOCK_TIMEOUT_SQL);
    return collectInventory({ query: async (sql) => ({ rows: await tx.$queryRawUnsafe<unknown[]>(sql) }) });
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 20000 });
}
