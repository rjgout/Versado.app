/** Uitsluitend een bewuste operatoractie; nooit via seed, deploy of containerstart. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
const flags = process.argv.slice(2),
  at = flags.indexOf("--admin-user-id"),
  adminId = at >= 0 ? flags[at + 1] : null;
const hash = createHash("sha256");
for (const name of ["source-lock.json", "media-lock.json", "otb-index.json"]) {
  hash
    .update(name)
    .update("\0")
    .update(await fs.readFile(`data/study-content/cfm-2026-nl/${name}`));
}
const approved = hash.digest("hex");
if (
  !flags.includes("--confirm-drafts-only") ||
  !adminId ||
  !/^[A-Za-z0-9_-]{1,128}$/.test(adminId) ||
  process.env.CFM_DRAFT_IMPORT_APPROVED_SNAPSHOT !== approved
) {
  console.error(
    `Geen import uitgevoerd. Vereist: --confirm-drafts-only --admin-user-id <bestaande-beheerder> en CFM_DRAFT_IMPORT_APPROVED_SNAPSHOT=${approved}. Productie vereist afzonderlijke toestemming.`,
  );
  process.exit(2);
}
const { prisma } = await import("../../src/lib/db");
try {
  const actor = await prisma.user.findUnique({
    where: { id: adminId },
    select: { id: true, isAdmin: true },
  });
  if (!actor?.isAdmin) throw Error("FORBIDDEN");
  const { importCfm2026Drafts } =
    await import("../../src/lib/studyContent/cfm2026Import");
  const result = await importCfm2026Drafts(actor);
  await fs.writeFile(
    `/tmp/versado-cfm-2026-drafts-${Date.now()}.json`,
    JSON.stringify(result, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    JSON.stringify({
      expected: 52,
      concepts: result.importedLessons,
      publicatieGewijzigd: false,
    }),
  );
} catch {
  console.error(
    "Conceptimport niet volledig afgerond. Controleer de bestaande admin-importruns; publicaties zijn niet gewijzigd.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
