import { createPrismaClient } from "../../src/lib/db";
import { importOtbTrial } from "./import-core";
import { preparePinnedOtbSource } from "./source";

async function main(): Promise<void> {
  const sourceFlag = process.argv.indexOf("--source");
  const sourceRoot = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : process.env.OTB_SOURCE_DIR ?? await preparePinnedOtbSource();
  if (!sourceRoot) throw new Error("Gebruik: npm run otb:import-trial -- --source /pad/naar/open-bible");
  const prisma = createPrismaClient();
  try {
    await importOtbTrial(prisma, sourceRoot);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
