// Optioneel CLI-alternatief; dezelfde analyse en SELECTs als de beheerfunctie.
// Node 24+; geen impliciete DATABASE_URL, backfill, backup of publicatie.
import pg from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { collectInventory as collectSnapshot, READ_ONLY_SQL, TIMEOUT_SQL, LOCK_TIMEOUT_SQL } from "../../src/lib/content-inventory/core.ts";
export { analyseIdentities } from "../../src/lib/content-inventory/core.ts";

export async function collectInventory(client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await client.query(READ_ONLY_SQL);
    await client.query(TIMEOUT_SQL);
    await client.query(LOCK_TIMEOUT_SQL);
    const report = await collectSnapshot(client);
    await client.query("COMMIT");
    return report;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.CONTENT_INVENTORY_DATABASE_URL, destination = process.argv[2];
  if (!url || !destination) throw new Error("Vereist: expliciet geautoriseerde CONTENT_INVENTORY_DATABASE_URL en uitvoerbestand; geen DATABASE_URL-fallback");
  let client;
  try {
    client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await client.connect();
    const report = await collectInventory(client);
    await writeFile(destination, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    console.log(`Inventaris geschreven; ${report.collections.length} collecties. Geen gegevens gewijzigd.`);
  } catch {
    console.error("Inventarisatie mislukt; geen gegevens gewijzigd."); process.exitCode = 1;
  } finally { await client?.end(); }
}
