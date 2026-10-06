import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Nieuwe client via de pg-driver. Scripts (seed, import) maken hun eigen
 * client; de app gebruikt de gedeelde `prisma` hieronder. `url` alleen
 * voor scripts die bewust een andere database aanspreken.
 */
export function createPrismaClient(options: { url?: string; log?: ("error" | "warn")[] } = {}): PrismaClient {
  // Prisma 5 las .env zelf; de pg-driver niet. Lokaal (tsx server.ts,
  // scripts) staat DATABASE_URL vaak alleen daar, en deze module wordt
  // geladen voordat Next zijn .env inleest. In Docker is hij al gezet.
  if (!options.url && !process.env.DATABASE_URL) {
    try {
      process.loadEnvFile();
    } catch {}
  }
  const adapter = new PrismaPg({
    connectionString: options.url ?? process.env.DATABASE_URL,
    // pg wacht standaard eindeloos op een verbinding. Deze ene grens geldt
    // voor zowel opbouwen als wachten op een vrije verbinding; Prisma 5 gaf
    // daar samen 15 s voor (5 + 10). Met 5 s faalde bij het opstarten op de
    // NAS al eens de eerste query, terwijl de database gewoon bereikbaar was.
    connectionTimeoutMillis: 15_000,
  });
  return new PrismaClient({ adapter, log: options.log ?? ["error"] });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
