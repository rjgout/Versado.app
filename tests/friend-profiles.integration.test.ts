// Vriendenprofielen testen tegen uitsluitend de aparte testdatabase. Elke
// rij krijgt een unieke testnaam en de cleanup verwijdert alleen die rijen.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  profiles: await import("../src/lib/friendProfiles"),
  featured: await import("../src/lib/featuredAchievements"),
});
let L: Awaited<ReturnType<typeof load>>;
const userIds: string[] = [];
const achievementIds: string[] = [];
let number = 0;

async function user(label: string) {
  number += 1;
  const row = await L.db.user.create({
    data: {
      email: `friend-profile-${Date.now()}-${number}@test.invalid`,
      passwordHash: "x",
      handle: `Profiel${label}`,
      discriminator: String(1000 + number),
      xpTotal: number * 100,
      currentStreak: number,
    },
  });
  userIds.push(row.id);
  return row;
}

async function achievement(slug: string) {
  const row = await L.db.achievement.create({ data: { slug: `test-friend-profile-${Date.now()}-${slug}`, name: slug, description: `Beschrijving ${slug}`, icon: "★" } });
  achievementIds.push(row.id);
  return row;
}

before(async () => {
  if (!skip) L = await load();
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: userIds } } });
  await L.db.achievement.deleteMany({ where: { id: { in: achievementIds } } });
  await L.db.$disconnect();
});

test("alleen geaccepteerde vrienden zien een profiel, met privéprestaties standaard verborgen", { skip }, async () => {
  const viewer = await user("Kijker");
  const friend = await user("Vriend");
  await L.db.friendship.create({ data: { senderId: viewer.id, receiverId: friend.id, status: "ACCEPTED" } });

  const privateProfile = await L.profiles.getFriendProfile(viewer.id, friend.id);
  assert.ok(privateProfile);
  assert.equal(privateProfile.sharesAchievements, false);
  assert.equal(privateProfile.stats, null, "XP, reeks en badges horen niet in een privéantwoord");

  const stranger = await user("GeenVriend");
  assert.equal(await L.profiles.getFriendProfile(stranger.id, friend.id), null);
  assert.equal(await L.profiles.getFriendProfile(viewer.id, viewer.id), null);
});

test("gedeelde uitgelichte prestaties behouden volgorde en accepteren alleen behaalde ids", { skip }, async () => {
  const viewer = await user("Kijker2");
  const friend = await user("Vriend2");
  await L.db.friendship.create({ data: { senderId: viewer.id, receiverId: friend.id, status: "ACCEPTED" } });
  const first = await achievement("eerste");
  const second = await achievement("tweede");
  const missing = await achievement("niet-behaald");
  await L.db.userAchievement.createMany({ data: [{ userId: friend.id, achievementId: first.id }, { userId: friend.id, achievementId: second.id }] });
  await L.db.user.update({ where: { id: friend.id }, data: { shareAchievements: true } });

  await L.featured.saveFeaturedAchievements(friend.id, [second.id, first.id]);
  const shared = await L.profiles.getFriendProfile(viewer.id, friend.id);
  assert.deepEqual(shared?.stats?.featuredAchievements.map((item) => item.id), [second.id, first.id]);
  assert.equal(shared?.stats?.xpTotal, friend.xpTotal);
  assert.equal(shared?.stats?.currentStreak, friend.currentStreak);

  await assert.rejects(() => L.featured.saveFeaturedAchievements(friend.id, [missing.id]), /INVALID_FEATURED_ACHIEVEMENTS/);
  await assert.rejects(() => L.featured.saveFeaturedAchievements(friend.id, [first.id, first.id]), /INVALID_FEATURED_ACHIEVEMENTS/);
  await assert.rejects(() => L.featured.saveFeaturedAchievements(friend.id, [first.id, second.id, first.id, second.id, first.id, second.id]), /INVALID_FEATURED_ACHIEVEMENTS/);
  const unchanged = await L.profiles.getFriendProfile(viewer.id, friend.id);
  assert.deepEqual(unchanged?.stats?.featuredAchievements.map((item) => item.id), [second.id, first.id], "ongeldige wijzigingen wissen de bestaande selectie niet");
});

test("een openstaand of verwijderd verzoek geeft geen profieltoegang", { skip }, async () => {
  const viewer = await user("Kijker3");
  const pending = await user("Wachtend");
  const removed = await user("Verwijderd");
  await L.db.friendship.create({ data: { senderId: viewer.id, receiverId: pending.id, status: "PENDING" } });
  const friendship = await L.db.friendship.create({ data: { senderId: viewer.id, receiverId: removed.id, status: "ACCEPTED" } });
  await L.db.friendship.delete({ where: { id: friendship.id } });
  assert.equal(await L.profiles.getFriendProfile(viewer.id, pending.id), null);
  assert.equal(await L.profiles.getFriendProfile(viewer.id, removed.id), null);
});
