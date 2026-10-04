// Integratietests voor Samen (vriendenreeksen, groepen, geschonken
// bevriezingen, seintjes, privacy) tegen een echte Postgres-database. Draait
// alleen met LEARNING_TEST_DATABASE_URL; gebruikt dagen ver in de toekomst
// en ruimt eigen gebruikers en groepen op.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:social
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  friends: await import("../src/lib/social/friendStreaks"),
  groups: await import("../src/lib/social/groups"),
  streak: await import("../src/lib/social/groupStreak"),
  freeze: await import("../src/lib/social/groupFreeze"),
  nudges: await import("../src/lib/social/nudges"),
  views: await import("../src/lib/social/groupViews"),
  common: await import("../src/lib/social/common"),
  days: await import("../src/lib/social/groupDays"),
});
let L: Awaited<ReturnType<typeof load>>;

const users: string[] = [];
const groupIds: string[] = [];
const D0 = "2031-05-05";
const D1 = "2031-05-06";
const D2 = "2031-05-07";
const D3 = "2031-05-08";
const D4 = "2031-05-09";
/** 12:00 in Nederland (zomertijd). */
const noon = (day: string) => new Date(`${day}T10:00:00Z`);
/** De ochtend erna, 08:00 in Nederland: de dag is dan voor Nederlanders voorbij. */
const morningAfter = (day: string) => new Date(new Date(`${day}T06:00:00Z`).getTime() + 24 * 3_600_000);
const plusDays = (date: Date, n: number) => new Date(date.getTime() + n * 24 * 3_600_000);

let seq = 0;
async function user(name: string, timeZone = "Europe/Amsterdam", extra: { freezeCount?: number } = {}): Promise<string> {
  seq += 1;
  const u = await L.db.user.create({
    data: {
      email: `samen-${name}-${Date.now()}-${seq}@test.invalid`,
      passwordHash: "x",
      handle: `Samen${name}`,
      discriminator: String(1000 + seq),
      timeZone,
      freezeCount: extra.freezeCount ?? 0,
    },
  });
  users.push(u.id);
  return u.id;
}

async function befriend(a: string, b: string): Promise<void> {
  if (await L.friends.areFriends(L.db, a, b)) return;
  await L.db.friendship.create({ data: { senderId: a, receiverId: b, status: "ACCEPTED" } });
}

/** De persoonlijke reeks: deze dag behouden. currentStreak 0 = de reeksafsluiting heeft gemiste dagen al verwerkt. */
async function kept(userId: string, dayKey: string, status: "STUDIED" | "FROZEN" = "STUDIED"): Promise<void> {
  await L.db.streakDay.create({ data: { userId, dayKey, status } });
}

async function rejects(promise: Promise<unknown>, key: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof L.common.SocialError, `geen SocialError: ${String(error)}`);
    assert.equal(error.key, key);
    return true;
  });
}

async function newGroup(adminId: string, name: string, members: string[], at: Date): Promise<string> {
  const { id } = await L.groups.createGroup(adminId, name, at);
  groupIds.push(id);
  for (const member of members) {
    await befriend(adminId, member);
    await L.groups.inviteToGroup(adminId, id, member, at);
    const invite = await L.db.groupInvite.findUniqueOrThrow({ where: { groupId_inviteeId: { groupId: id, inviteeId: member } } });
    await L.groups.respondGroupInvite(member, invite.id, true, at);
  }
  return id;
}

const group = (id: string) => L.db.socialGroup.findUniqueOrThrow({ where: { id } });
const day = (groupId: string, dayKey: string) => L.db.groupDay.findUnique({ where: { groupId_dayKey: { groupId, dayKey } } });
const freezes = async (id: string) => (await L.db.user.findUniqueOrThrow({ where: { id } })).freezeCount;

before(async () => {
  if (skip) return;
  L = await load();
});

after(async () => {
  if (skip) return;
  await L.db.socialGroup.deleteMany({ where: { id: { in: groupIds } } });
  await L.db.user.deleteMany({ where: { id: { in: users } } });
  await L.db.$disconnect();
});

// --- Vriendenreeksen -------------------------------------------------------

test("vriendenreeks: beiden dragen bij, één niet, prestaties blijven, plek komt vrij", { skip }, async () => {
  const a = await user("A");
  const b = await user("B");
  await befriend(a, b);
  const { id } = await L.friends.inviteFriendStreak(a, b);
  await rejects(L.friends.inviteFriendStreak(b, a), "together.errors.friendStreakPending");
  await L.friends.respondFriendStreak(b, id, true, noon(D1));
  let s = await L.db.friendStreak.findUniqueOrThrow({ where: { id } });
  assert.equal(s.status, "ACTIVE");
  assert.equal(s.startDay, D1);

  await kept(a, D1);
  await L.friends.refreshFriendStreak(id, noon(D1));
  assert.equal((await L.db.friendStreak.findUniqueOrThrow({ where: { id } })).currentStreak, 0, "alleen A: nog niet");
  await kept(b, D1);
  await L.friends.refreshFriendStreak(id, noon(D1));
  await L.friends.refreshFriendStreak(id, noon(D1)); // dubbel verwerken doet niets
  s = await L.db.friendStreak.findUniqueOrThrow({ where: { id } });
  assert.equal(s.currentStreak, 1);
  assert.equal(s.lastAchievedDay, D1);
  const slugs = async (u: string) => (await L.db.userAchievement.findMany({ where: { userId: u }, include: { achievement: true } })).map((x) => x.achievement.slug);
  assert.deepEqual((await slugs(a)).filter((x) => x.startsWith("friend-streak")), ["friend-streak-1"]);
  assert.deepEqual((await slugs(b)).filter((x) => x.startsWith("friend-streak")), ["friend-streak-1"]);

  // Dag 2: alleen A. Tijdens de dag nog niets aan de hand ...
  await kept(a, D2);
  await L.friends.refreshFriendStreak(id, noon(D2));
  assert.equal((await L.db.friendStreak.findUniqueOrThrow({ where: { id } })).status, "ACTIVE");
  // ... na afloop verbroken, de plek is vrij, de prestatie blijft.
  await L.friends.refreshFriendStreak(id, morningAfter(D2));
  s = await L.db.friendStreak.findUniqueOrThrow({ where: { id } });
  assert.equal(s.status, "BROKEN");
  assert.equal(s.openKey, null);
  assert.equal(s.longestStreak, 1);
  assert.ok((await slugs(a)).includes("friend-streak-1"));
  const again = await L.friends.inviteFriendStreak(a, b);
  assert.notEqual(again.id, id);
});

test("vriendenreeks: een persoonlijke bevriezing telt als behouden", { skip }, async () => {
  const a = await user("FrA");
  const b = await user("FrB");
  await befriend(a, b);
  const { id } = await L.friends.inviteFriendStreak(a, b);
  await L.friends.respondFriendStreak(b, id, true, noon(D1));
  await kept(a, D1);
  await kept(b, D1, "FROZEN");
  await L.friends.refreshFriendStreak(id, morningAfter(D1));
  const s = await L.db.friendStreak.findUniqueOrThrow({ where: { id } });
  assert.equal(s.status, "ACTIVE");
  assert.equal(s.currentStreak, 1);
});

test("vriendenreeks: ieder op de eigen kalenderdag, geen compensatie tussen tijdzones", { skip }, async () => {
  const ams = await user("TzA");
  const tokyo = await user("TzT", "Asia/Tokyo");
  await befriend(ams, tokyo);
  const { id } = await L.friends.inviteFriendStreak(ams, tokyo);
  await L.friends.respondFriendStreak(tokyo, id, true, noon(D1)); // NL 12:00, Tokio 19:00: allebei 6 mei
  await kept(tokyo, D1);
  // Tokio is al op 7 mei, Nederland nog op 6 mei: niet verbroken, wacht op Nederland.
  const tokyoNextDay = new Date(`${D1}T16:00:00Z`);
  await L.friends.refreshFriendStreak(id, tokyoNextDay);
  assert.equal((await L.db.friendStreak.findUniqueOrThrow({ where: { id } })).status, "ACTIVE");
  await kept(ams, D1);
  await L.friends.refreshFriendStreak(id, tokyoNextDay);
  assert.equal((await L.db.friendStreak.findUniqueOrThrow({ where: { id } })).currentStreak, 1);
  // Lijst voor Nederland: vandaag (6 mei) allebei gehaald.
  const view = await L.friends.listFriendStreaks(ams, "Europe/Amsterdam", tokyoNextDay);
  assert.deepEqual(view.streaks[0].today, { me: true, friend: true });
});

test("vriendenreeks: maximaal 5, niet handmatig te beëindigen, accepteren controleert opnieuw", { skip }, async () => {
  const g = await user("Max");
  const friends: string[] = [];
  for (let i = 0; i < 7; i++) {
    const f = await user(`MaxF${i}`);
    await befriend(g, f);
    friends.push(f);
  }
  // Een uitnodiging die al openstaat voordat de plekken vol zijn.
  const early = await L.friends.inviteFriendStreak(friends[6], g);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const { id } = await L.friends.inviteFriendStreak(g, friends[i]);
    await L.friends.respondFriendStreak(friends[i], id, true, noon(D1));
    ids.push(id);
  }
  await rejects(L.friends.inviteFriendStreak(g, friends[5]), "together.errors.friendStreakLimit");
  await rejects(L.friends.respondFriendStreak(g, early.id, true, noon(D1)), "together.errors.friendStreakLimit");
  // Een lopende reeks intrekken kan niet.
  await rejects(L.friends.cancelFriendStreakInvite(g, ids[0]), "together.errors.friendStreakNotFound");
  // Pas als een reeks echt verbreekt, komt de plek vrij.
  await L.friends.refreshFriendStreak(ids[0], morningAfter(D1));
  assert.equal((await L.db.friendStreak.findUniqueOrThrow({ where: { id: ids[0] } })).status, "BROKEN");
  await L.friends.inviteFriendStreak(g, friends[5]);
});

// --- Groepen ---------------------------------------------------------------

test("groep: toetreden en vertrekken tijdens de dag, behaalde dag blijft behaald", { skip }, async () => {
  const m = [await user("G1"), await user("G2"), await user("G3"), await user("G4")];
  const gid = await newGroup(m[0], "Wijk Groningen", [m[1], m[2]], noon(D0));
  const memberships = await L.db.groupMembership.findMany({ where: { groupId: gid } });
  assert.ok(memberships.every((x) => x.eligibleFromDay === D1));
  assert.equal((await group(gid)).memberCount, 3);

  // M4 komt erbij op 6 mei: telt pas vanaf 7 mei; het aantal nodig voor 6 mei blijft 3.
  await befriend(m[0], m[3]);
  await L.groups.inviteToGroup(m[0], gid, m[3], noon(D1));
  const invite = await L.db.groupInvite.findUniqueOrThrow({ where: { groupId_inviteeId: { groupId: gid, inviteeId: m[3] } } });
  await L.groups.respondGroupInvite(m[3], invite.id, true, noon(D1));
  await L.groups.respondGroupInvite(m[3], invite.id, true, noon(D1)); // idempotent
  assert.equal((await group(gid)).memberCount, 4);
  assert.equal((await L.db.groupMembership.findUniqueOrThrow({ where: { groupId_userId: { groupId: gid, userId: m[3] } } })).eligibleFromDay, D2);
  assert.deepEqual((await L.days.groupDayCounts(L.db, [gid], D1)).get(gid), { eligible: 3, contributors: 0 });

  for (const id of m.slice(0, 3)) await kept(id, D1);
  await Promise.all([L.streak.refreshGroup(gid, noon(D1)), L.streak.refreshGroup(gid, noon(D1))]);
  let g = await group(gid);
  assert.equal(g.currentStreak, 1);
  assert.equal((await day(gid, D1))?.status, "ACHIEVED");
  assert.equal(await L.db.groupAchievement.count({ where: { groupId: gid, slug: "first-day" } }), 1);

  // 7 mei: 4 leden, 3 nodig. M3 vertrekt halverwege: dan 3 leden, 3 nodig.
  assert.deepEqual((await L.days.groupDayCounts(L.db, [gid], D2)).get(gid), { eligible: 4, contributors: 0 });
  await L.groups.leaveGroup(m[2], gid, noon(D2));
  assert.deepEqual((await L.days.groupDayCounts(L.db, [gid], D2)).get(gid), { eligible: 3, contributors: 0 });
  // 6 mei is afgesloten en blijft gehaald.
  await L.streak.refreshGroup(gid, morningAfter(D1));
  assert.equal((await day(gid, D1))?.status, "ACHIEVED");
  g = await group(gid);
  assert.equal(g.memberCount, 3);
  assert.equal(g.currentStreak, 1);
});

test("groep: 7 dagen wachttijd na vertrek, ook niet te omzeilen met een uitnodiging", { skip }, async () => {
  const a = await user("Cd1");
  const b = await user("Cd2");
  const c = await user("Cd3");
  const gid = await newGroup(a, "Seminarie", [b, c], noon(D0));
  await L.groups.removeMember(a, gid, c, noon(D1));
  await L.groups.removeMember(a, gid, c, noon(D1)); // twee beheerders tegelijk: onschuldig
  assert.equal((await group(gid)).memberCount, 2);
  await rejects(L.groups.inviteToGroup(a, gid, c, noon(D2)), "together.errors.groupInviteeCooldown");
  // Een oude uitnodiging accepteren controleert de wachttijd opnieuw.
  const stale = await L.db.groupInvite.upsert({
    where: { groupId_inviteeId: { groupId: gid, inviteeId: c } },
    create: { groupId: gid, inviteeId: c, inviterId: a, status: "PENDING" },
    update: { status: "PENDING" },
  });
  await rejects(L.groups.respondGroupInvite(c, stale.id, true, noon(D2)), "together.errors.groupRejoinCooldown");
  await L.groups.respondGroupInvite(c, stale.id, true, plusDays(noon(D1), 7));
  assert.equal((await group(gid)).memberCount, 3);
});

test("groep: onder 3 leden gepauzeerd (niet verbroken), daarna verder", { skip }, async () => {
  const p = [await user("P1"), await user("P2"), await user("P3"), await user("P4")];
  const gid = await newGroup(p[0], "Gezin De Vries", [p[1], p[2]], noon(D0));
  for (const id of p.slice(0, 3)) await kept(id, D1);
  await L.streak.refreshGroup(gid, morningAfter(D1));
  assert.equal((await group(gid)).currentStreak, 1);

  await L.groups.leaveGroup(p[2], gid, noon(D2));
  await befriend(p[0], p[3]);
  await L.groups.inviteToGroup(p[0], gid, p[3], noon(D2));
  const inv = await L.db.groupInvite.findUniqueOrThrow({ where: { groupId_inviteeId: { groupId: gid, inviteeId: p[3] } } });
  await L.groups.respondGroupInvite(p[3], inv.id, true, noon(D2));
  const today = (await L.views.groupDetail(gid, p[0], "Europe/Amsterdam", noon(D2)))!.today;
  assert.equal(today.required, null);
  assert.equal(today.paused, "starts-tomorrow");

  await L.streak.refreshGroup(gid, morningAfter(D2));
  let g = await group(gid);
  assert.equal((await day(gid, D2))?.status, "PAUSED");
  assert.equal(g.currentStreak, 1, "gepauzeerd: reeks blijft staan");
  assert.equal(g.paused, true);

  for (const id of [p[0], p[1], p[3]]) await kept(id, D3);
  await L.streak.refreshGroup(gid, morningAfter(D3));
  g = await group(gid);
  assert.equal(g.currentStreak, 2, "een gepauzeerde dag telt niet mee");
  assert.equal(g.paused, false);
  const events = (await L.db.socialEvent.findMany({ where: { groupId: gid } })).map((e) => e.kind);
  for (const kind of ["GROUP_CREATED", "GROUP_STREAK_STARTED", "GROUP_PAUSED", "GROUP_RESUMED", "MEMBER_LEFT"]) assert.ok(events.includes(kind), kind);
});

test("groep: maximaal 10 groepen per persoon en maximaal 500 leden", { skip }, async () => {
  const u = await user("Lim");
  for (let i = 0; i < 10; i++) groupIds.push((await L.groups.createGroup(u, `Groep ${i}`, noon(D0))).id);
  await rejects(L.groups.createGroup(u, "Elf", noon(D0)), "together.errors.groupUserLimit");

  const owner = await user("Full");
  const joiner = await user("FullJ");
  const { id: gid } = await L.groups.createGroup(owner, "Vol", noon(D0));
  groupIds.push(gid);
  await befriend(owner, joiner);
  await L.groups.inviteToGroup(owner, gid, joiner, noon(D0));
  await L.db.socialGroup.update({ where: { id: gid }, data: { memberCount: 500 } });
  const inv = await L.db.groupInvite.findUniqueOrThrow({ where: { groupId_inviteeId: { groupId: gid, inviteeId: joiner } } });
  await rejects(L.groups.respondGroupInvite(joiner, inv.id, true, noon(D0)), "together.errors.groupFull");
});

test("beheerders: na 14 dagen zonder studie gewoon lid, opvolger met de grootste bijdrage", { skip }, async () => {
  const admin = await user("Adm");
  const b1 = await user("AdmB1");
  const b2 = await user("AdmB2");
  const b3 = await user("AdmB3");
  const start = noon(D0);
  const gid = await newGroup(admin, "Familie", [b1, b2, b3], start);
  // Twee gehaalde dagen in de huidige reeks; B2 en B3 droegen allebei twee
  // keer bij, B1 één keer. B2 is eerder lid dan B3.
  await L.db.groupDay.createMany({ data: [D1, D2].map((dayKey) => ({ groupId: gid, dayKey, status: "ACHIEVED" as const })) });
  await L.db.socialGroup.update({ where: { id: gid }, data: { streakStartDay: D1, currentStreak: 2 } });
  for (const [id, days] of [[b1, [D1]], [b2, [D1, D2]], [b3, [D1, D2]]] as const) for (const d of days) await kept(id, d);
  const later = plusDays(start, 16);
  const recent = later.toISOString().slice(0, 10);
  for (const id of [b1, b2, b3]) await L.db.streakDay.create({ data: { userId: id, dayKey: recent, status: "STUDIED" } });

  await L.groups.runGroupAdminMaintenance(plusDays(start, 10));
  assert.equal((await L.db.groupMembership.findUniqueOrThrow({ where: { groupId_userId: { groupId: gid, userId: admin } } })).role, "ADMIN", "nog geen 14 dagen");

  await L.groups.runGroupAdminMaintenance(later);
  const roles = Object.fromEntries((await L.db.groupMembership.findMany({ where: { groupId: gid } })).map((m) => [m.userId, [m.role, m.leftAt]]));
  assert.deepEqual(roles[admin], ["MEMBER", null], "blijft lid");
  assert.equal(roles[b2][0], "ADMIN", "grootste bijdrage, langst lid");
  assert.equal(roles[b3][0], "MEMBER");
  // Kan opnieuw beheerder worden, en daarna weer gewoon verwijderd.
  await L.groups.setMemberRole(b2, gid, admin, "ADMIN", later);
  await rejects(L.groups.removeMember(b2, gid, admin, later), "together.errors.groupRemoveAdmin");
  await L.groups.setMemberRole(b2, gid, admin, "MEMBER", later);
  await L.groups.removeMember(b2, gid, admin, later);
  // De laatste beheerder kan zijn rol niet zomaar afgeven.
  await rejects(L.groups.setMemberRole(b2, gid, b2, "MEMBER", later), "together.errors.groupLastAdmin");
  // Vertrekt de laatste beheerder, dan volgt automatisch een opvolger.
  await L.groups.leaveGroup(b2, gid, later);
  assert.equal(await L.db.groupMembership.count({ where: { groupId: gid, leftAt: null, role: "ADMIN" } }), 1);
});

// --- Geschonken reeksbevriezing ---------------------------------------------

test("bevriezing: aangeboden, niet nodig, wel nodig, wachttijd per groep", { skip }, async () => {
  const q = [await user("Q1", "Europe/Amsterdam", { freezeCount: 2 }), await user("Q2", "Europe/Amsterdam", { freezeCount: 1 }), await user("Q3"), await user("Q4")];
  const gid = await newGroup(q[0], "Vriendengroep", [q[1], q[2], q[3]], noon(D0));

  // 6 mei: Q1 biedt aan, Q2 kan er niet nog een bij doen.
  await L.freeze.offerGroupFreeze(q[0], gid, noon(D1));
  assert.equal(await freezes(q[0]), 1, "gereserveerd");
  await rejects(L.freeze.offerGroupFreeze(q[1], gid, noon(D1)), "together.errors.groupFreezeAlreadyOffered");
  assert.equal(await freezes(q[1]), 1);
  let detail = (await L.views.groupDetail(gid, q[2], "Europe/Amsterdam", noon(D1)))!;
  assert.equal(detail.today.protectedBy?.id, q[0]);
  assert.equal(detail.today.achieved, false, "beschermd is niet gehaald");
  // Het doel wordt toch gehaald: de bevriezing gaat terug, zonder wachttijd.
  for (const id of q.slice(0, 3)) await kept(id, D1);
  await L.streak.refreshGroup(gid, noon(D1));
  assert.equal(await freezes(q[0]), 2);
  assert.equal((await L.db.groupFreezeOffer.findFirstOrThrow({ where: { groupId: gid, dayKey: D1 } })).status, "RELEASED");
  assert.equal(await L.freeze.freezeCooldownUntil(L.db, q[0], gid, noon(D2)), null);
  await rejects(L.freeze.offerGroupFreeze(q[0], gid, noon(D1)), "together.errors.groupFreezeNotNeeded");

  // 7 mei: twee tegelijk aanbieden, er komt er één door.
  const both = await Promise.allSettled([L.freeze.offerGroupFreeze(q[0], gid, noon(D2)), L.freeze.offerGroupFreeze(q[1], gid, noon(D2))]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
  const offer = await L.db.groupFreezeOffer.findFirstOrThrow({ where: { groupId: gid, dayKey: D2 } });
  const donor = offer.userId;
  // Alleen Q3 draagt bij: 1 van 3. Na afloop wordt de bevriezing gebruikt; de reeks blijft 1.
  await kept(q[2], D2);
  await L.streak.refreshGroup(gid, morningAfter(D1));
  await L.streak.refreshGroup(gid, morningAfter(D2));
  await L.streak.refreshGroup(gid, morningAfter(D2));
  assert.equal((await day(gid, D2))?.status, "PROTECTED");
  assert.equal((await L.db.groupFreezeOffer.findUniqueOrThrow({ where: { id: offer.id } })).status, "CONSUMED");
  assert.equal((await group(gid)).currentStreak, 1, "niet verhoogd");
  assert.equal(await L.db.groupAchievement.count({ where: { groupId: gid, slug: "rescued" } }), 1);
  const used = await L.db.socialEvent.findFirstOrThrow({ where: { groupId: gid, kind: "FREEZE_USED" } });
  assert.equal(used.userId, donor);

  // 8 mei: weer gehaald, dan 2 (niet 3).
  for (const id of q.slice(0, 3)) await kept(id, D3);
  await L.streak.refreshGroup(gid, morningAfter(D3));
  assert.equal((await group(gid)).currentStreak, 2);

  // Wachttijd: 30 dagen voor deze gebruiker in deze groep; een ander mag wel,
  // en in een andere groep mag hij ook.
  await L.db.user.update({ where: { id: donor }, data: { freezeCount: { increment: 2 } } });
  await rejects(L.freeze.offerGroupFreeze(donor, gid, noon(D4)), "together.errors.groupFreezeCooldown");
  const other = donor === q[0] ? q[1] : q[0];
  await L.db.user.update({ where: { id: other }, data: { freezeCount: { increment: 1 } } });
  await L.freeze.offerGroupFreeze(other, gid, noon(D4));
  const g2 = await newGroup(donor, "Andere groep", [q[2], q[3]], noon(D0));
  await L.freeze.offerGroupFreeze(donor, g2, noon(D4));

  // Vertrekken en terugkomen zet de wachttijd niet terug.
  await L.groups.leaveGroup(donor, gid, noon(D4));
  const back = plusDays(noon(D4), 8);
  await befriend(q[2], donor);
  await L.groups.inviteToGroup(q[2], gid, donor, back);
  const inv = await L.db.groupInvite.findUniqueOrThrow({ where: { groupId_inviteeId: { groupId: gid, inviteeId: donor } } });
  await L.groups.respondGroupInvite(donor, inv.id, true, back);
  assert.ok(await L.freeze.freezeCooldownUntil(L.db, donor, gid, back));
});

test("bevriezing: vertrekken geeft een gereserveerde bevriezing terug", { skip }, async () => {
  const a = await user("Rv1");
  const b = await user("Rv2", "Europe/Amsterdam", { freezeCount: 1 });
  const c = await user("Rv3");
  const gid = await newGroup(a, "Klas", [b, c], noon(D0));
  await L.freeze.offerGroupFreeze(b, gid, noon(D1));
  assert.equal(await freezes(b), 0);
  await L.groups.leaveGroup(b, gid, noon(D1));
  assert.equal(await freezes(b), 1);
  assert.equal((await L.db.groupFreezeOffer.findFirstOrThrow({ where: { groupId: gid, dayKey: D1 } })).status, "CANCELLED");
});

test("groep gemist zonder bevriezing: reeks blijft staan en wordt onderbroken", { skip }, async () => {
  const a = await user("Br1");
  const b = await user("Br2");
  const c = await user("Br3");
  const gid = await newGroup(a, "Breuk", [b, c], noon(D0));
  for (const id of [a, b, c]) await kept(id, D1);
  await L.streak.refreshGroup(gid, morningAfter(D1));
  await kept(a, D2);
  await L.streak.refreshGroup(gid, morningAfter(D2));
  const g = await group(gid);
  assert.equal((await day(gid, D2))?.status, "MISSED");
  assert.equal(g.currentStreak, 1);
  assert.equal(g.streakInterruptedDay, D2);
  assert.equal(g.longestStreak, 1);
  assert.equal(await L.db.groupAchievement.count({ where: { groupId: gid } }), 2, "eerste dag en iedereen deed mee");
  // Eigen bijdrage, vanaf de eigen instapdag: 2 afgesloten dagen, A droeg 2 keer bij.
  const detail = (await L.views.groupDetail(gid, a, "Europe/Amsterdam", noon(D3)))!;
  assert.deepEqual({ days: detail.myContribution.days, contributed: detail.myContribution.contributed }, { days: 2, contributed: 2 });
});

test("onderbroken groepsreeks gaat verder met één normale groepsdag", { skip }, async () => {
  const a = await user("Ci1");
  const b = await user("Ci2");
  const c = await user("Ci3");
  const gid = await newGroup(a, "Verder", [b, c], noon(D0));
  for (const id of [a, b, c]) await kept(id, D1);
  await L.streak.refreshGroup(gid, morningAfter(D1));
  await L.streak.refreshGroup(gid, morningAfter(D2));
  let g = await group(gid);
  assert.equal(g.currentStreak, 1);
  assert.equal(g.streakInterruptedDay, D2);

  for (const id of [a, b, c]) await kept(id, D3);
  await L.streak.refreshGroup(gid, noon(D3));
  g = await group(gid);
  assert.equal(g.currentStreak, 2);
  assert.equal(g.streakInterruptedDay, null);
  assert.equal((await day(gid, D3))?.status, "ACHIEVED");
  assert.ok((await L.db.socialEvent.findMany({ where: { groupId: gid }, select: { kind: true } })).some((e) => e.kind === "GROUP_STREAK_CONTINUED"));
});

test("pauze sluit een lid vanaf de volgende groepsdag uit en studeren beëindigt haar vroeg", { skip }, async () => {
  const a = await user("Pz1");
  const b = await user("Pz2");
  const c = await user("Pz3");
  const d = await user("Pz4");
  const gid = await newGroup(a, "Pauze", [b, c, d], noon(D0));

  for (const id of [a, b, c, d]) await kept(id, D1);
  await L.streak.refreshGroup(gid, morningAfter(D1));
  assert.equal((await day(gid, D1))?.status, "ACHIEVED");

  const pause = await L.groups.pauseMemberForGroupStreak(a, gid, b, 7, noon(D1));
  assert.equal(pause.fromDay, D2);
  assert.equal(pause.untilDay, "2031-05-13");
  assert.equal((await L.db.groupMembership.findUniqueOrThrow({ where: { groupId_userId: { groupId: gid, userId: b } } })).role, "MEMBER");
  assert.deepEqual((await L.days.groupDayCounts(L.db, [gid], D1)).get(gid), { eligible: 4, contributors: 4 });
  assert.deepEqual((await L.days.groupDayCounts(L.db, [gid], D2)).get(gid), { eligible: 3, contributors: 0 });

  await L.streak.refreshGroupsFor([b], noon(D2), []);
  assert.equal((await L.db.groupMembership.findUniqueOrThrow({ where: { groupId_userId: { groupId: gid, userId: b } } })).streakPauseUntilDay, "2031-05-13");
  await L.groups.endGroupStreakPausesForActivity([b], noon(D2));
  const membership = await L.db.groupMembership.findUniqueOrThrow({ where: { groupId_userId: { groupId: gid, userId: b } } });
  assert.equal(membership.streakPauseUntilDay, D2);
  assert.equal(membership.lastStreakPauseEndedDay, D2);
  assert.deepEqual((await L.days.groupDayCounts(L.db, [gid], D2)).get(gid), { eligible: 3, contributors: 0 });
  assert.deepEqual((await L.days.groupDayCounts(L.db, [gid], D3)).get(gid), { eligible: 4, contributors: 0 });

  const e = await user("Pz5");
  const f = await user("Pz6");
  const g = await user("Pz7");
  const small = await newGroup(e, "Te weinig", [f, g], noon(D0));
  await L.groups.pauseMemberForGroupStreak(e, small, f, 1, noon(D1));
  await L.streak.refreshGroup(small, morningAfter(D2));
  assert.equal((await group(small)).paused, true);
  assert.equal((await group(small)).streakInterruptedDay, null);
});

test("groepspauze is begrensd en heeft een groepsgebonden cooldown", { skip }, async () => {
  const a = await user("Pc1");
  const b = await user("Pc2");
  const c = await user("Pc3");
  const d = await user("Pc4");
  const gid = await newGroup(a, "Cooldown", [b, c, d], noon(D0));
  await rejects(L.groups.pauseMemberForGroupStreak(a, gid, b, 31, noon(D1)), "together.errors.groupPauseDurationInvalid");
  await L.groups.pauseMemberForGroupStreak(a, gid, b, 1, noon(D1));
  await L.groups.endGroupStreakPausesForActivity([b], noon(D2));
  await rejects(L.groups.pauseMemberForGroupStreak(a, gid, b, 1, noon(D2)), "together.errors.groupPauseCooldown");
  await L.groups.pauseMemberForGroupStreak(a, gid, b, 1, noon("2031-06-08"));
  await L.groups.pauseMemberForGroupStreak(a, gid, c, 1, noon(D2));
  const gid2 = await newGroup(a, "Andere cooldown", [b, c, d], noon(D0));
  await L.groups.pauseMemberForGroupStreak(a, gid2, b, 1, noon("2031-06-08"));
});

// --- Seintjes en privacy -----------------------------------------------------

test("seintjes: alleen vrienden, één per 6 uur, instelling, geen XP", { skip }, async () => {
  const a = await user("N1");
  const b = await user("N2");
  const stranger = await user("N3");
  await befriend(a, b);
  const t0 = noon(D1);
  await rejects(L.nudges.sendNudge(a, stranger, { kind: "general" }, t0), "together.errors.nudgeFriendsOnly");
  const both = await Promise.allSettled([L.nudges.sendNudge(a, b, { kind: "general" }, t0), L.nudges.sendNudge(a, b, { kind: "general" }, t0)]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
  await rejects(L.nudges.sendNudge(a, b, { kind: "general" }, new Date(t0.getTime() + 5 * 3_600_000)), "together.errors.nudgeTooSoon");
  await L.nudges.sendNudge(a, b, { kind: "general" }, new Date(t0.getTime() + 6 * 3_600_000));
  // De andere richting heeft een eigen grens.
  await L.nudges.sendNudge(b, a, { kind: "general" }, t0);
  // Zonder vriendenreeks geen seintje met die context.
  await rejects(L.nudges.sendNudge(b, a, { kind: "friend-streak" }, plusDays(t0, 1)), "together.errors.friendStreakNotFound");
  await L.db.user.update({ where: { id: b }, data: { nudgesEnabled: false } });
  await rejects(L.nudges.sendNudge(a, b, { kind: "general" }, plusDays(t0, 2)), "together.errors.nudgesOff");
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: a } })).xpTotal, 0);
  assert.equal(await L.db.xPTransaction.count({ where: { userId: a } }), 0);
});

test("privacy: privégroep niet zichtbaar, openbare groep zonder leden", { skip }, async () => {
  const a = await user("Pr1");
  const b = await user("Pr2");
  const c = await user("Pr3");
  const outsider = await user("Pr4");
  const gid = await newGroup(a, "Privé", [b, c], noon(D0));
  assert.equal((await L.views.groupLeaderboard("streak", outsider, 500)).some((g) => g.id === gid), false);
  assert.equal(await L.views.publicGroup(gid), null);
  assert.equal(await L.views.groupDetail(gid, outsider, null, noon(D1)), null);
  await rejects(L.groups.updateGroupSettings(b, gid, { showOnLeaderboard: true }), "together.errors.groupAdminOnly");

  await L.groups.updateGroupSettings(a, gid, { showOnLeaderboard: true });
  const row = (await L.views.groupLeaderboard("size", outsider, 500)).find((g) => g.id === gid);
  assert.ok(row);
  assert.deepEqual(Object.keys(row).sort(), ["achievementCount", "currentStreak", "id", "isMine", "memberCount", "name", "rank"]);
  const open = await L.views.publicGroup(gid);
  assert.ok(open);
  assert.equal("members" in open, false);
  // Een lid ziet wel de leden.
  assert.equal((await L.views.groupDetail(gid, b, null, noon(D1)))!.members.length, 3);
  // Uitnodigen kan alleen voor eigen vrienden.
  await rejects(L.groups.inviteToGroup(b, gid, outsider, noon(D1)), "together.errors.groupInviteFriendsOnly");
  await L.groups.updateGroupSettings(a, gid, { membersCanInvite: false });
  await befriend(b, outsider);
  await rejects(L.groups.inviteToGroup(b, gid, outsider, noon(D1)), "together.errors.groupInviteNotAllowed");
});
