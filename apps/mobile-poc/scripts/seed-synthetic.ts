/* Synthetische testaccounts voor de mobiele proef — uitsluitend voor een geïsoleerde test-database.
 * Draaien vanuit de repo-root: DATABASE_URL=... npx tsx apps/mobile-poc/scripts/seed-synthetic.ts */
import { createPrismaClient } from "../../../src/lib/db";
import { hashPassword } from "../../../src/lib/auth";

const url = process.env.DATABASE_URL ?? "";
// Bescherming tegen per ongeluk seeden van een echte database.
if (!/(127\.0\.0\.1|localhost|postgres)(:\d+)?\/[a-z_]*(test|poc)[a-z_]*/i.test(url) && process.env.POC_ALLOW_SEED !== "1") {
  console.error("Weigert te seeden: DATABASE_URL lijkt geen geïsoleerde test-/poc-database (zet POC_ALLOW_SEED=1 om te forceren).");
  process.exit(1);
}
const password = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
(async () => {
  const prisma = createPrismaClient();
  const passwordHash = await hashPassword(password);
  const base = { passwordHash, emailVerifiedAt: new Date(), onboardingSeenAt: new Date() };
  const mk = (name: string, disc: string) => prisma.user.upsert({ where: { email: `${name.toLowerCase()}@example.invalid` }, update: { passwordHash }, create: { ...base, email: `${name.toLowerCase()}@example.invalid`, handle: name, discriminator: disc } });
  const [alice, bob, carol] = [await mk("Alice", "01"), await mk("Bob", "02"), await mk("Carol", "03")];
  const ids = [alice.id, bob.id, carol.id];
  await prisma.friendship.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } });
  await prisma.friendship.create({ data: { senderId: bob.id, receiverId: alice.id, status: "PENDING" } });   // inkomend verzoek voor Alice
  await prisma.friendship.create({ data: { senderId: alice.id, receiverId: carol.id, status: "ACCEPTED" } }); // bestaande vriend
  console.log("synthetische accounts: alice/bob/carol@example.invalid");
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
