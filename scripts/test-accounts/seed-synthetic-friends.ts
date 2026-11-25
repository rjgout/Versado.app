// Reproduceerbare, volledig losstaande testset voor de Vrienden-flow in de afgeschermde dev-/testomgeving. NOOIT voor productie en nooit
// automatisch (geen seed, migratie, deployment of app-start). Raakt nooit een bestaand account: alleen de vaste @example.invalid-accounts
// hieronder worden gemaakt of verwijderd.
//
//   npx tsx scripts/test-accounts/seed-synthetic-friends.ts                       # dry-run (standaard): toont feiten en plan
//   npx tsx scripts/test-accounts/seed-synthetic-friends.ts --apply --verwacht-database=<host>:<poort>/<database>
//   npx tsx scripts/test-accounts/seed-synthetic-friends.ts --verwijder --apply --verwacht-database=...   # ruimt de set op
//
// Twee onafhankelijke testidentiteiten MET inlog (voor twee toestellen), elk met een eenmalig getoond willekeurig wachtwoord:
//   Test A  → vriendenlijst met een bestaande vriend, een INKOMEND verzoek (van Verzoek-in) en een UITGAAND verzoek (naar Verzoek-uit)
//   Test B  → lege vriendenlijst, geen relatie met Test A (om zelf een verzoek te sturen en te accepteren)
// Drie tegenpartijen zonder inlog (willekeurig, niet bewaard wachtwoord): Vriend, Verzoek-in, Verzoek-uit.
// Wachtwoorden verschijnen alleen op stdout bij het aanmaken; opnieuw tonen kan niet (verwijderen en opnieuw aanmaken).
import { randomBytes } from "node:crypto";
import { confirmsDatabaseIdentity, formatDatabaseIdentity, resolveDatabase } from "../courses/target";
import { refusalReason } from "./guard";

const apply = process.argv.includes("--apply");
const remove = process.argv.includes("--verwijder");
const confirmation = process.argv.find(arg => arg.startsWith("--verwacht-database="))?.slice("--verwacht-database=".length);
const SET = [
  { key: "a", email: "test-a@example.invalid", handle: "TestA", login: true },
  { key: "b", email: "test-b@example.invalid", handle: "TestB", login: true },
  { key: "friend", email: "test-vriend@example.invalid", handle: "TestVriend", login: false },
  { key: "in", email: "test-verzoek-in@example.invalid", handle: "TestVerzoekIn", login: false },
  { key: "out", email: "test-verzoek-uit@example.invalid", handle: "TestVerzoekUit", login: false },
] as const;

function stop(message: string): never { console.error(`Weigering: ${message}`); process.exit(2); }
const database = resolveDatabase();
console.error(`Doeldatabase: ${formatDatabaseIdentity(database.label)}${apply ? " (WIJZIGT GEGEVENS)" : " (dry-run)"}`);
process.env.DATABASE_URL = database.url;
const { prisma } = await import("../../src/lib/db");
try {
  const [{ comment }] = await prisma.$queryRaw<{ comment: string | null }[]>`SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()`;
  const userCount = await prisma.user.count();
  const reason = refusalReason({ database: database.label.database, databaseComment: comment, appUrl: process.env.APP_URL, userCount });
  if (reason) stop(reason);
  if (apply && !confirmsDatabaseIdentity(database.label, confirmation)) stop(`--apply vereist --verwacht-database=${formatDatabaseIdentity(database.label)}.`);

  const existing = await prisma.user.findMany({ where: { email: { in: SET.map(item => item.email) } }, select: { id: true, email: true } });
  if (remove) {
    console.error(`${apply ? "Verwijdert" : "Zou verwijderen"}: ${existing.length} van ${SET.length} synthetische accounts (exacte @example.invalid-adressen; relaties verdwijnen mee).`);
    if (apply) for (const row of existing) await prisma.user.delete({ where: { id: row.id } });
  } else if (existing.length > 0) {
    stop(`${existing.length} van de testaccounts bestaan al (wachtwoorden zijn niet opnieuw te tonen). Verwijder de set eerst met --verwijder --apply.`);
  } else {
    console.error(`${apply ? "Maakt" : "Zou maken"}: ${SET.length} accounts, 1 bestaande vriendschap, 1 inkomend en 1 uitgaand verzoek.`);
    if (apply) {
      const [{ createAccount }, { hashPassword }, { getOrCreateInviteCode, becomeFriendsViaInvite }, { createFriendRequestOnce }] = await Promise.all([
        import("../../src/lib/registration"), import("../../src/lib/auth"), import("../../src/lib/friendInvite"), import("../../src/lib/social/friendshipPair"),
      ]);
      const ids: Record<string, string> = {};
      for (const item of SET) {
        const password = randomBytes(18).toString("base64url");
        const created = await createAccount({ email: item.email, handle: item.handle, passwordHash: await hashPassword(password), uiLanguage: "nl", contentLanguage: "nl", emailVerifiedAt: new Date() });
        ids[item.key] = created.id;
        // @example.invalid is onbereikbaar: geen mail proberen te versturen (ook niet via meldingen bij vriendschapsgebeurtenissen).
        await prisma.user.update({ where: { id: created.id }, data: { emailNotificationsEnabled: false } });
        if (item.login) console.log(`${item.handle}\t${item.email}\t${password}`);
      }
      // Bestaande vriendschap via de bestaande uitnodigingsroute; verzoeken via de dienst achter /api/friends/request.
      await becomeFriendsViaInvite(await getOrCreateInviteCode(ids.friend), ids.a, { isNewAccount: false });
      await prisma.$transaction(tx => createFriendRequestOnce(tx, ids.in, ids.a));
      await prisma.$transaction(tx => createFriendRequestOnce(tx, ids.a, ids.out));
      // De bestaande diensten sturen meldingen fire-and-forget; even laten afronden voordat de verbinding sluit.
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.error("Klaar. Wachtwoorden staan alleen hierboven (stdout); bewaar ze buiten de repository.");
    }
  }
} finally {
  await prisma.$disconnect();
}
