// Offline validatie van een aangeleverd rapport; geen databasebinding of productiequery.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { sanitizeInventory, analyseIdentities } from "../../src/lib/content-inventory/core.ts";

// Bewezen oorspronkelijke bestanden uit parent van hernoemcommit 48c5384.
// Geen algemene aliasheuristiek: iedere uitzondering heeft exact bronbewijs.
const historical = {
  "1789767235_add_person_fields": { checksum: "fd355a8e0d834ed93ef221c19356023f5557ea97871b0aa379421652b4487007", replacement: "20260918213534_add_person_fields" },
  "1789831396_add_user_avatar_emoji": { checksum: "38e7595f7865615192369787de615cd22cb6e9a29f1769a7c3b8f83714534450", replacement: "20260919152904_add_user_avatar_emoji" },
};
export function validateInventorySnapshot(raw, sqlForName) {
  const report = sanitizeInventory(raw);
  const blockers = [];
  if (!isDeepStrictEqual(report.identities, analyseIdentities(report.collections))) blockers.push("IDENTITY_ANALYSIS_MISMATCH");
  if (new Set(report.collections.map(c => c.id)).size !== report.collections.length) blockers.push("DUPLICATE_COLLECTION_ID");
  if (Number(report.counts.ContentCollection) !== report.collections.length) blockers.push("COLLECTION_COUNT_MISMATCH");
  if (report.identities.issues.length || report.identities.nullWorkCollectionIds.length) blockers.push("IDENTITY_REVIEW_REQUIRED");
  if (Object.values(report.integrity).some(n => n !== "0")) blockers.push("RELATION_REVIEW_REQUIRED");
  const applied = report.migrations.filter(m => m.finished_at && !m.rolled_back_at);
  const matched = name => {
    const sql = sqlForName(name);
    return sql !== null && applied.some(m => m.migration_name === name && m.checksum === createHash("sha256").update(sql).digest("hex"));
  };
  const migrations = report.migrations.map(m => {
    if (m.rolled_back_at) {
      const superseded = applied.some(success => success.migration_name === m.migration_name && success.started_at > m.started_at) && matched(m.migration_name);
      if (!superseded) blockers.push(`ROLLBACK_REVIEW_REQUIRED:${m.migration_name}`);
      return { name: m.migration_name, status: "historical-rollback", superseded };
    }
    if (!m.finished_at) { blockers.push(`UNFINISHED_MIGRATION:${m.migration_name}`); return { name: m.migration_name, status: "unfinished" }; }
    const sql = sqlForName(m.migration_name);
    if (sql !== null && createHash("sha256").update(sql).digest("hex") === m.checksum) return { name: m.migration_name, status: "repository-match" };
    const proof = historical[m.migration_name];
    if (proof?.checksum === m.checksum && matched(proof.replacement)) return { name: m.migration_name, status: "proven-historical-rename", replacement: proof.replacement };
    blockers.push(`CHECKSUM_REVIEW_REQUIRED:${m.migration_name}`);
    return { name: m.migration_name, status: "unverified" };
  });
  return { report, blockers, migrations };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error("REPORT_REQUIRED");
    const bytes = readFileSync(process.argv[2]);
    const result = validateInventorySnapshot(JSON.parse(bytes.toString()), name => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null;
      try { return readFileSync(resolve("prisma/migrations", name, "migration.sql")); } catch { return null; }
    });
    console.log(JSON.stringify({ capturedAt: result.report.capturedAt, reportSha256: createHash("sha256").update(bytes).digest("hex"),
      collections: result.report.collections.length, works: result.report.identities.works.length,
      publicationFieldPresent: result.report.publicationFieldPresent, blockers: result.blockers,
      migrations: result.migrations.reduce((summary, m) => ({ ...summary, [m.status]: (summary[m.status] ?? 0) + 1 }), {}),
      exceptions: result.migrations.filter(m => m.status !== "repository-match") }, null, 2));
    if (result.blockers.length) process.exitCode = 1;
  } catch { console.error("Rapportvalidatie mislukt; controleer het bestand in een besloten omgeving."); process.exitCode = 1; }
}
