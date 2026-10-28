import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { ContentUpdateRun, Prisma, PrismaClient } from "@/generated/prisma/client";

/** Een proces bezit de logrij zolang het werkt, ook vóór het de algemene importlock krijgt (bronvoorbereiding).
 * De sessielock vervalt bij procesuitval; een ander proces kan daarna veilig de achtergelaten run markeren.
 * De lock wordt vóór het invoegen genomen: er bestaat nooit een zichtbare actieve rij zonder eigenaar. */
export async function withContentUpdateRun<T>(
  db: PrismaClient,
  data: Prisma.ContentUpdateRunCreateInput,
  work: (run: ContentUpdateRun) => Promise<T>,
): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ontbreekt voor het contentbeheerlogboek.");
  const id = randomUUID();
  const owner = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000, keepAlive: true });
  owner.on("error", (error) => console.error(`[contentUpdateRun] eigenaarsverbinding verbroken: ${error.message}`));
  await owner.connect();
  try {
    await owner.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`content-update-run:${id}`]);
    const run = await db.contentUpdateRun.create({ data: { ...data, id } });
    return await work(run);
  } finally {
    await owner.end().catch(() => undefined);
  }
}
