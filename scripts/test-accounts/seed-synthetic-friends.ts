// Drie synthetische vriendenaccounts voor handmatig testen van Vrienden, uitnodigingen, Activiteit en Competitie in de afgeschermde
// dev-/testomgeving. NOOIT voor productie en nooit automatisch (geen seed, migratie of app-start roept dit aan).
//   npx tsx scripts/test-accounts/seed-synthetic-friends.ts --voor=<handle#nummer>                  # dry-run (standaard)
//   npx tsx scripts/test-accounts/seed-synthetic-friends.ts --voor=<handle#nummer> --apply --verwacht-database=<host>:<poort>/<database>
//   npx tsx scripts/test-accounts/seed-synthetic-friends.ts --voor=<handle#nummer> --verwijder --apply --verwacht-database=...
// Voorwaarden voor --apply: VERSADO_TEST_OMGEVING=dev-test in de omgeving van dit proces (de eigenaar zet die bewust, alleen in de
// afgeschermde stack) én de letterlijke databasebevestiging. Accounts ontstaan via `createAccount` en de bestaande uitnodigingsroute
// (`becomeFriendsViaInvite` via inviteCode), dus met dezelfde privacy- en vriendschapsregels als echte gebruikers. Het e-mailadres
// eindigt altijd op @example.invalid (onbereikbaar, nooit versturen), er is geen gedeelde of vaste wachtwoordwaarde: het wachtwoord is
// willekeurig, wordt niet bewaard en niet getoond; inloggen als testvriend is dus niet nodig en niet mogelijk.
import { randomBytes } from "node:crypto";
import { confirmsDatabaseIdentity, formatDatabaseIdentity, resolveDatabase } from "../courses/target";

const apply = process.argv.includes("--apply");
const remove = process.argv.includes("--verwijder");
const owner = process.argv.find(arg => arg.startsWith("--voor="))?.slice("--voor=".length);
const confirmation = process.argv.find(arg => arg.startsWith("--verwacht-database="))?.slice("--verwacht-database=".length);
const SYNTHETIC_FRIENDS = [
  { email: "testvriend-1@example.invalid", handle: "Testvriend1" },
  { email: "testvriend-2@example.invalid", handle: "Testvriend2" },
  { email: "testvriend-3@example.invalid", handle: "Testvriend3" },
] as const;

function stop(message: string): never { console.error(`Weigering: ${message}`); process.exit(2); }
if (!owner || !/^[^#\s]{1,40}#\d{1,2}$/.test(owner)) stop("geef het account op waarvoor de testvrienden gelden, bv. --voor=Raphael#42");
const database = resolveDatabase();
console.error(`Doeldatabase: ${formatDatabaseIdentity(database.label)}${apply ? " (WIJZIGT GEGEVENS)" : " (dry-run)"}`);
if (apply && process.env.VERSADO_TEST_OMGEVING !== "dev-test") stop("--apply werkt alleen in de afgeschermde dev-/testomgeving (VERSADO_TEST_OMGEVING=dev-test).");
if (apply && !confirmsDatabaseIdentity(database.label, confirmation)) stop(`--apply vereist --verwacht-database=${formatDatabaseIdentity(database.label)}.`);
process.env.DATABASE_URL = database.url;

const [{ prisma }, { createAccount }, { hashPassword }, { getOrCreateInviteCode, becomeFriendsViaInvite }, { parseTag }] = await Promise.all([
  import("../../src/lib/db"), import("../../src/lib/registration"), import("../../src/lib/auth"), import("../../src/lib/friendInvite"), import("../../src/lib/handle"),
]);
try {
  const tag = parseTag(owner);
  if (!tag) stop("ongeldige accountaanduiding.");
  const { handle, discriminator } = tag;
  const user = await prisma.user.findFirst({ where: { handle, discriminator } });
  if (!user) stop("het opgegeven account bestaat niet in deze database.");
  const existing = await prisma.user.findMany({ where: { email: { in: SYNTHETIC_FRIENDS.map(friend => friend.email) } }, select: { id: true, email: true } });
  if (remove) {
    console.error(`${apply ? "Verwijdert" : "Zou verwijderen"}: ${existing.length} synthetische account(s) (alleen exacte @example.invalid-testadressen).`);
    if (apply) for (const row of existing) await prisma.user.delete({ where: { id: row.id } });
  } else {
    const missing = SYNTHETIC_FRIENDS.filter(friend => !existing.some(row => row.email === friend.email));
    console.error(`Bestaat al: ${existing.length}; ${apply ? "maakt aan" : "zou aanmaken"}: ${missing.length}; ${apply ? "koppelt" : "zou koppelen"} aan het opgegeven account via de uitnodigingsroute.`);
    if (apply) {
      const code = await getOrCreateInviteCode(user.id);
      for (const friend of missing) {
        await createAccount({ email: friend.email, handle: friend.handle, passwordHash: await hashPassword(randomBytes(24).toString("base64url")), uiLanguage: user.uiLanguage, contentLanguage: user.contentLanguage, inviteCode: code, emailVerifiedAt: new Date() });
      }
      for (const row of existing) await becomeFriendsViaInvite(code, row.id, { isNewAccount: false });
    }
  }
} finally {
  await prisma.$disconnect();
}
