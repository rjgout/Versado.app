import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Privacy en vriendenranglijsten van puzzelrecords. Alleen met een eigen testdatabase; nooit tegen productie.
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  records: await import("../src/lib/puzzle/records"),
  profiles: await import("../src/lib/friendProfiles"),
  variants: await import("../src/lib/puzzle/variants"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => { if (skip) return; await L.db.user.deleteMany({ where: { id: { in: ids } } }); await L.db.$disconnect(); });

async function person(share = false, shareAchievements = false) {
  const user = await L.db.user.create({ data: { email: `lb-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Lb${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "Europe/Amsterdam", sharePuzzleRecords: share, shareAchievements } });
  ids.push(user.id); return user;
}
const befriend = (a: string, b: string, status: "ACCEPTED" | "PENDING" | "DECLINED" = "ACCEPTED") => L.db.friendship.create({ data: { senderId: a, receiverId: b, status } });
async function variant(index: number, pieces: 6 | 12 = 6) { return (await L.variants.ensureVariant(index, pieces, "ADVENTURER")).variant; }
const put = (userId: string, variantId: string, ms: number, hints = 0, extra = 0, mode: "SOLO" | "MATCH" = "SOLO", completedAt = new Date()) =>
  L.db.$transaction((tx) => L.records.registerBestRecord(tx, { userId, variantId, mode, elapsedMs: ms, hintsUsed: hints, extraHintsUsed: extra, completedAt, sessionId: `s-${randomUUID()}` }));
const names = async (viewer: string, variantId: string, mode: "SOLO" | "MATCH", cat: "NO_HINTS" | "WITH_HINTS") => (await L.records.friendLeaderboard(viewer, variantId, mode, cat))!.rows.map((r) => r.user.id);

test("privacy: puzzelrecords staan standaard uit en zijn onafhankelijk van shareAchievements", { skip }, async () => {
  const fresh = await person();
  assert.equal(fresh.sharePuzzleRecords, false); assert.equal(fresh.shareAchievements, false);
  const [viewer, friend] = [await person(), await person(false, true)];
  await befriend(viewer.id, friend.id);
  const v = await variant(30); await put(friend.id, v.id, 100_000);
  assert.equal((await names(viewer.id, v.id, "SOLO", "NO_HINTS")).includes(friend.id), false, "shareAchievements=true geeft geen toestemming voor puzzelrecords");
  const profile = await L.profiles.getFriendProfile(viewer.id, friend.id);
  assert.equal(profile!.sharesAchievements, true); assert.equal(profile!.puzzleRecords, null);
  // Omgekeerd: puzzelrecords delen geeft geen toegang tot andere prestaties.
  const [v2, f2] = [await person(), await person(true, false)];
  await befriend(v2.id, f2.id); await put(f2.id, v.id, 90_000);
  const profile2 = await L.profiles.getFriendProfile(v2.id, f2.id);
  assert.equal(profile2!.stats, null); assert.equal(profile2!.puzzleRecords!.length, 1);
});

test("privacy: eigen record altijd zichtbaar; uitzetten verbergt direct, aanzetten toont opnieuw; vriendschap en status bepalen toegang", { skip }, async () => {
  const [me, friend, pending, declined, stranger, removed] = [await person(false), await person(true), await person(true), await person(true), await person(true), await person(true)];
  await befriend(me.id, friend.id); await befriend(me.id, pending.id, "PENDING"); await befriend(declined.id, me.id, "DECLINED"); const gone = await befriend(removed.id, me.id);
  const v = await variant(31);
  for (const [u, ms] of [[me, 120_000], [friend, 100_000], [pending, 50_000], [declined, 40_000], [stranger, 30_000], [removed, 20_000]] as const) await put(u.id, v.id, ms);
  assert.deepEqual(await names(me.id, v.id, "SOLO", "NO_HINTS"), [removed.id, friend.id, me.id], "alleen ik en geaccepteerde delende vrienden");
  await L.db.friendship.delete({ where: { id: gone.id } });
  assert.deepEqual(await names(me.id, v.id, "SOLO", "NO_HINTS"), [friend.id, me.id], "verbroken vriendschap trekt toegang in");
  await L.db.user.update({ where: { id: friend.id }, data: { sharePuzzleRecords: false } });
  assert.deepEqual(await names(me.id, v.id, "SOLO", "NO_HINTS"), [me.id], "uitzetten verbergt de records onmiddellijk; ik blijf mezelf zien");
  assert.equal(await L.profiles.getFriendProfile(me.id, friend.id).then((p) => p!.puzzleRecords), null);
  await L.db.user.update({ where: { id: friend.id }, data: { sharePuzzleRecords: true } });
  assert.deepEqual(await names(me.id, v.id, "SOLO", "NO_HINTS"), [friend.id, me.id], "de gegevens bleven bewaard en zijn weer zichtbaar");
  // De vriend ziet mij niet, want mijn delen staat uit; alleen zichzelf.
  assert.deepEqual(await names(friend.id, v.id, "SOLO", "NO_HINTS"), [friend.id]);
  assert.equal(await L.profiles.getFriendProfile(friend.id, me.id).then((p) => p!.puzzleRecords), null);
  assert.equal(await L.records.sharedRecordsOf(stranger.id, friend.id), null, "geen vriendschap, geen inzage");
});

test("ranglijst: exacte variant, modus en hintcategorie gescheiden; sortering en tie-breakers", { skip }, async () => {
  const [me, a, b, c, d] = [await person(true), await person(true), await person(true), await person(true), await person(true)];
  for (const f of [a, b, c, d]) await befriend(me.id, f.id);
  const v = await variant(32); const other = await variant(33); const bigger = await variant(32, 12);
  const early = new Date("2026-01-01T00:00:00Z"); const late = new Date("2026-06-01T00:00:00Z");
  await put(a.id, v.id, 95_000.4, 0, 0, "SOLO", late);
  await put(b.id, v.id, 95_000.4, 0, 0, "SOLO", early);
  await put(c.id, v.id, 95_000.2);
  await put(d.id, v.id, 99_000, 2, 1); await put(me.id, v.id, 99_000, 1, 1); await put(a.id, v.id, 99_000, 1, 0);
  await put(a.id, other.id, 1); await put(a.id, bigger.id, 1); await put(a.id, v.id, 10, 0, 0, "MATCH");
  assert.deepEqual(await names(me.id, v.id, "SOLO", "NO_HINTS"), [c.id, b.id, a.id], "milliseconden, dan vroegste voltooiing");
  const hinted = await L.records.friendLeaderboard(me.id, v.id, "SOLO", "WITH_HINTS");
  assert.deepEqual(hinted!.rows.map((r) => r.user.id), [a.id, me.id, d.id], "gelijke tijd: minste persoonlijke extra hints, dan minste hints");
  assert.deepEqual(hinted!.rows.map((r) => [r.rank, r.hintsUsed, r.extraHintsUsed, r.isMe]), [[1, 1, 0, false], [2, 1, 1, true], [3, 2, 1, false]]);
  assert.deepEqual((await L.records.friendLeaderboard(me.id, v.id, "MATCH", "NO_HINTS"))!.rows.map((r) => r.user.id), [a.id], "Solo en wedstrijd zijn gescheiden");
  assert.equal((await L.records.friendLeaderboard(me.id, other.id, "SOLO", "NO_HINTS"))!.rows.length, 1, "een andere afbeelding is een andere ranglijst");
  assert.equal((await L.records.friendLeaderboard(me.id, v.id, "SOLO", "NO_HINTS"))!.rows.some((r) => r.hintsUsed > 0), false, "met hints staat nooit in zonder hints");
  assert.equal(await L.records.friendLeaderboard(me.id, "bestaat-niet", "SOLO", "NO_HINTS"), null, "onbekende variant: neutraal");
});

test("ranglijst: lege toestand, geen globale resultaten, geen onbevoegden of gevoelige velden", { skip }, async () => {
  const [me, other] = [await person(true), await person(true)];
  const v = await variant(34); await put(other.id, v.id, 10_000);
  const board = (await L.records.friendLeaderboard(me.id, v.id, "SOLO", "NO_HINTS"))!;
  assert.deepEqual(board.rows, [], "iemand die geen vriend is, staat er niet in");
  const mine = await L.records.listOwnRecords(me.id); assert.deepEqual(mine, []);
  await put(me.id, v.id, 20_000);
  const row = (await L.records.friendLeaderboard(me.id, v.id, "SOLO", "NO_HINTS"))!.rows[0];
  const json = JSON.stringify(row);
  assert.equal(row.isMe, true);
  for (const secret of ["email", "passwordHash", "sharePuzzleRecords", "sessionId", "hintBalance"]) assert.equal(json.includes(secret), false, secret);
  assert.deepEqual(Object.keys(row.user).sort(), ["avatarBackgroundId", "avatarCharacterId", "avatarDecorationId", "avatarEmoji", "avatarFrameId", "avatarLightAccentId", "discriminator", "handle", "id"]);
  // Eigen overzicht met filters en zonder andermans records.
  await put(me.id, v.id, 21_000, 1);
  assert.equal((await L.records.listOwnRecords(me.id, { hintCategory: "WITH_HINTS" })).length, 1);
  assert.equal((await L.records.listOwnRecords(me.id, { mode: "MATCH" })).length, 0);
});
