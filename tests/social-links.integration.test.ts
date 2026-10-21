// Integratietests voor groepslinks/QR en toegangsverzoeken, de persoonlijke
// pushmeldingen rond geschonken bevriezingen en de zuinigheid van de
// minuuttaak. Draait alleen met LEARNING_TEST_DATABASE_URL.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:social
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-samen-tests-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  links: await import("../src/lib/social/joinLinks"),
  groups: await import("../src/lib/social/groups"),
  streak: await import("../src/lib/social/groupStreak"),
  freeze: await import("../src/lib/social/groupFreeze"),
  friends: await import("../src/lib/social/friendStreaks"),
  views: await import("../src/lib/social/groupViews"),
  common: await import("../src/lib/social/common"),
  rules: await import("../src/lib/social/rules"),
  push: await import("../src/lib/push"),
});
let L: Awaited<ReturnType<typeof load>>;

const users: string[] = [];
const groupIds: string[] = [];
const D0 = "2032-06-01";
const D1 = "2032-06-02";
const D2 = "2032-06-03";
const noon = (day: string) => new Date(`${day}T10:00:00Z`);
const morningAfter = (day: string) => new Date(new Date(`${day}T06:00:00Z`).getTime() + 24 * 3_600_000);
const plusDays = (date: Date, n: number) => new Date(date.getTime() + n * 24 * 3_600_000);

let seq = 0;
async function user(name: string, extra: { freezeCount?: number; push?: boolean } = {}): Promise<string> {
  seq += 1;
  const u = await L.db.user.create({
    data: {
      email: `link-${name}-${Date.now()}-${seq}@test.invalid`,
      passwordHash: "x",
      handle: `Link${name}`,
      discriminator: String(2000 + seq),
      timeZone: "Europe/Amsterdam",
      freezeCount: extra.freezeCount ?? 0,
      pushNotificationsEnabled: !!extra.push,
    },
  });
  users.push(u.id);
  if (extra.push) {
    // Provider-vorm moet het productiebeleid doorstaan; het transport hieronder blijft volledig gemockt.
    await L.db.pushSubscription.create({ data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/social-test/${u.id}`, p256dh: "p", auth: "a" } });
  }
  return u.id;
}

async function befriend(a: string, b: string): Promise<void> {
  if (await L.friends.areFriends(L.db, a, b)) return;
  await L.db.friendship.create({ data: { senderId: a, receiverId: b, status: "ACCEPTED" } });
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

async function rejects(promise: Promise<unknown>, key: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof L.common.SocialError, `geen SocialError: ${String(error)}`);
    assert.equal(error.key, key);
    return true;
  });
}

/** Wacht tot een fire-and-forget melding is verwerkt. */
async function eventually(check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("niet op tijd");
}

const pushes: string[] = [];
const pushedTo = (id: string) => pushes.filter((endpoint) => endpoint.endsWith(`/${id}`)).length;
const notes = (id: string) => L.db.notification.findMany({ where: { userId: id }, select: { title: true, body: true, kind: true } });
const memberIds = async (groupId: string) => (await L.db.groupMembership.findMany({ where: { groupId, leftAt: null }, select: { userId: true } })).map((m) => m.userId).sort();

before(async () => {
  if (skip) return;
  L = await load();
  // Geen echte pushdienst: alleen tellen wie een push zou krijgen.
  L.push.pushTransport.send = async (subscription) => {
    pushes.push(subscription.endpoint);
    return { statusCode: 201, body: "", headers: {} };
  };
});

after(async () => {
  if (skip) return;
  await L.db.socialGroup.deleteMany({ where: { id: { in: groupIds } } });
  await L.db.user.deleteMany({ where: { id: { in: users } } });
  await L.db.$disconnect();
});

// --- Groepslink -------------------------------------------------------------

test("groepslink: aanzetten, veilig token, intrekken, nieuw token, oud blijft ongeldig", { skip }, async () => {
  const admin = await user("Adm");
  const member = await user("Mem");
  const gid = await newGroup(admin, "Linkgroep", [member], noon(D0));
  await rejects(L.links.enableGroupLink(member, gid), "together.errors.groupAdminOnly");

  const first = await L.links.enableGroupLink(admin, gid);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/, "256 bits als base64url");
  assert.equal(Buffer.from(first, "base64url").length, 32);
  assert.ok(!first.includes(gid), "geen groeps-id in het token");
  assert.equal(await L.links.enableGroupLink(admin, gid), first, "aanzetten is idempotent");
  // Tokens zijn steeds anders (willekeurig, niet afgeleid van de groep).
  const other = await newGroup(admin, "Andere", [], noon(D0));
  assert.notEqual(await L.links.enableGroupLink(admin, other), first);

  const outsider = await user("Out");
  assert.equal((await L.links.groupLinkView(first, outsider)).state, "preview");
  await rejects(L.links.revokeGroupLink(member, gid), "together.errors.groupAdminOnly");
  await L.links.revokeGroupLink(admin, gid);
  assert.deepEqual(await L.links.groupLinkView(first, outsider), { state: "invalid" });
  await rejects(L.links.requestToJoin(outsider, first), "together.errors.groupLinkInvalid");

  const second = await L.links.enableGroupLink(admin, gid);
  assert.notEqual(second, first);
  assert.deepEqual(await L.links.groupLinkView(first, outsider), { state: "invalid" }, "het oude token wordt nooit weer geldig");
  assert.equal((await L.links.groupLinkView(second, outsider)).state, "preview");

  // Ongeldige of misvormde tokens: niets, zonder te verraden of de groep bestaat.
  for (const bad of ["", "abc", gid, `${second}x`, second.slice(0, -1) + (second.endsWith("A") ? "B" : "A"), "../../etc/passwd"]) {
    assert.deepEqual(await L.links.groupLinkView(bad, outsider), { state: "invalid" }, bad);
    assert.deepEqual(await L.links.groupLinkView(bad, null), { state: "invalid" }, bad);
  }
});

test("voorpagina: niet ingelogd niets, lid naar de groep, vrienden of anders beheerders, geen ledenlijst", { skip }, async () => {
  const admin = await user("PvAdm");
  const a = await user("PvA");
  const b = await user("PvB");
  const stranger = await user("PvC");
  const gid = await newGroup(admin, "Seminarie", [a, b, stranger], noon(D0));
  const token = await L.links.enableGroupLink(admin, gid);

  // Niet ingelogd: alleen "log in", geen enkel groepsgegeven.
  const anon = await L.links.groupLinkView(token, null);
  assert.deepEqual(anon, { state: "login" });
  assert.ok(!JSON.stringify(anon).includes("Seminarie"));

  // Lid: rechtstreeks naar de groepspagina.
  assert.deepEqual(await L.links.groupLinkView(token, a), { state: "member", groupId: gid });

  // Bezoeker met twee vrienden in de groep: alleen die twee, geen anderen.
  const visitor = await user("PvVis");
  await befriend(visitor, a);
  await befriend(visitor, b);
  const view = await L.links.groupLinkView(token, visitor);
  assert.equal(view.state, "preview");
  if (view.state !== "preview") return;
  assert.deepEqual(view.friends.map((f) => f.id).sort(), [a, b].sort());
  assert.deepEqual(view.admins, [], "met vrienden geen beheerders nodig");
  assert.equal(view.group.name, "Seminarie");
  assert.equal(view.group.memberCount, 4);
  assert.deepEqual(Object.keys(view).sort(), ["admins", "friends", "group", "request", "state"]);
  assert.deepEqual(Object.keys(view.group).sort(), ["achievements", "currentStreak", "memberCount", "name"]);
  assert.ok(!JSON.stringify(view).includes(stranger), "een onbekend lid lekt niet");

  // Zonder vrienden: de beheerders, met alleen naam en avatar (geen id, geen nummer).
  const loner = await user("PvLoner");
  const lonely = await L.links.groupLinkView(token, loner);
  assert.equal(lonely.state, "preview");
  if (lonely.state !== "preview") return;
  assert.deepEqual(lonely.friends, []);
  assert.equal(lonely.admins.length, 1);
  assert.deepEqual(Object.keys(lonely.admins[0]).sort(), ["avatarEmoji", "handle", "key"]);
  assert.equal(lonely.admins[0].handle, "LinkPvAdm");
  const raw = JSON.stringify(lonely);
  for (const id of [admin, a, b, stranger]) assert.ok(!raw.includes(id), "geen gebruikers-id's naar buiten");
  assert.ok(!raw.includes("#"), "geen discriminator");
});

// --- Toegangsverzoeken --------------------------------------------------------

test("verzoek: één tegelijk, openstaand, weigeren met wachttijd, daarna weer kunnen vragen", { skip }, async () => {
  const admin = await user("RqAdm");
  const m1 = await user("RqM1");
  const m2 = await user("RqM2");
  const gid = await newGroup(admin, "Wijk", [m1, m2], noon(D0));
  const token = await L.links.enableGroupLink(admin, gid);
  const asker = await user("RqAsk");

  const both = await Promise.all([L.links.requestToJoin(asker, token, noon(D1)), L.links.requestToJoin(asker, token, noon(D1))]);
  assert.deepEqual(both.map((r) => r.status), ["pending", "pending"]);
  assert.equal(await L.db.groupJoinRequest.count({ where: { groupId: gid, userId: asker } }), 1, "geen dubbel verzoek");
  const view = await L.links.groupLinkView(token, asker, noon(D1));
  assert.equal(view.state === "preview" && view.request.status, "pending");
  assert.equal(await L.db.groupMembership.count({ where: { groupId: gid, userId: asker } }), 0, "een link maakt nooit lid");

  const [request] = await L.links.visibleJoinRequests(gid, admin);
  await L.links.decideJoinRequest(admin, request.id, false, noon(D1));
  const declined = await L.links.groupLinkView(token, asker, noon(D1));
  assert.equal(declined.state === "preview" && declined.request.status, "cooldown");
  await rejects(L.links.requestToJoin(asker, token, plusDays(noon(D1), 1)), "together.errors.joinRequestCooldown");
  // Niet voor altijd: na de wachttijd mag het opnieuw.
  const again = await L.links.requestToJoin(asker, token, plusDays(noon(D1), L.rules.JOIN_REQUEST_DECLINE_COOLDOWN_DAYS + 1));
  assert.equal(again.status, "pending");
  await eventually(async () => (await notes(asker)).some((n) => n.title.length > 0 && n.kind === "groups"));
});

test("verzoek: spamgrens per uur over alle groepen", { skip }, async () => {
  const admin = await user("SpAdm");
  const asker = await user("SpAsk");
  const tokens: string[] = [];
  for (let i = 0; i <= L.rules.JOIN_REQUEST_HOURLY_LIMIT; i++) {
    const gid = await newGroup(admin, `Spam ${i}`, [], noon(D0));
    tokens.push(await L.links.enableGroupLink(admin, gid));
  }
  for (const token of tokens.slice(0, -1)) await L.links.requestToJoin(asker, token, noon(D1));
  await rejects(L.links.requestToJoin(asker, tokens.at(-1)!, noon(D1)), "together.errors.joinRequestTooMany");
  await L.links.requestToJoin(asker, tokens.at(-1)!, new Date(noon(D1).getTime() + 61 * 60_000));
});

test("goedkeuren: wordt lid volgens de bestaande regels, twee goedkeuringen tegelijk = één lidmaatschap", { skip }, async () => {
  const admin = await user("ApAdm");
  const admin2 = await user("ApAdm2");
  const m = await user("ApM");
  const gid = await newGroup(admin, "Gezin", [admin2, m], noon(D0));
  await L.groups.setMemberRole(admin, gid, admin2, "ADMIN", noon(D0));
  const token = await L.links.enableGroupLink(admin, gid);
  const asker = await user("ApAsk");
  await L.links.requestToJoin(asker, token, noon(D1));
  const [request] = await L.links.visibleJoinRequests(gid, admin);

  const results = await Promise.allSettled([L.links.decideJoinRequest(admin, request.id, true, noon(D1)), L.links.decideJoinRequest(admin2, request.id, true, noon(D1))]);
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results));
  assert.deepEqual(results.map((r) => (r.status === "fulfilled" ? r.value.result : null)).sort(), ["already", "approved"]);
  assert.equal(await L.db.groupMembership.count({ where: { groupId: gid, userId: asker, leftAt: null } }), 1);
  assert.equal((await L.db.socialGroup.findUniqueOrThrow({ where: { id: gid } })).memberCount, 4);
  // Telt pas vanaf de volgende dag mee: het vereiste aantal van vandaag verandert niet.
  const membership = await L.db.groupMembership.findUniqueOrThrow({ where: { groupId_userId: { groupId: gid, userId: asker } } });
  assert.equal(membership.eligibleFromDay, D2);
  await eventually(async () => (await notes(asker)).some((n) => n.body.includes("Gezin")));
  // Daarna stuurt de link hem gewoon naar de groep.
  assert.deepEqual(await L.links.groupLinkView(token, asker), { state: "member", groupId: gid });
  assert.equal((await L.links.requestToJoin(asker, token)).status, "member");
});

test("goedkeuren controleert opnieuw: 500 leden, 10 groepen, 7 dagen wachttijd", { skip }, async () => {
  const admin = await user("LmAdm");
  const gid = await newGroup(admin, "Grenzen", [], noon(D0));
  const token = await L.links.enableGroupLink(admin, gid);

  // Vol geraakt terwijl het verzoek openstond.
  const a = await user("LmA");
  await L.links.requestToJoin(a, token, noon(D1));
  await L.db.socialGroup.update({ where: { id: gid }, data: { memberCount: 500 } });
  const [ra] = await L.links.visibleJoinRequests(gid, admin);
  await rejects(L.links.decideJoinRequest(admin, ra.id, true, noon(D1)), "together.errors.groupFull");
  assert.equal((await L.db.groupJoinRequest.findUniqueOrThrow({ where: { id: ra.id } })).status, "PENDING", "blijft open");
  await L.db.socialGroup.update({ where: { id: gid }, data: { memberCount: 1 } });

  // Inmiddels in 10 andere groepen.
  const b = await user("LmB");
  await L.links.requestToJoin(b, token, noon(D1));
  for (let i = 0; i < 10; i++) groupIds.push((await L.groups.createGroup(b, `Eigen ${i}`, noon(D0))).id);
  const rb = (await L.links.visibleJoinRequests(gid, admin)).find((r) => r.person.id === b)!;
  await rejects(L.links.decideJoinRequest(admin, rb.id, true, noon(D1)), "together.errors.groupUserLimit");

  // Net vertrokken: wachttijd, ook via een oud verzoek.
  const c = await user("LmC");
  await befriend(admin, c);
  await L.groups.inviteToGroup(admin, gid, c, noon(D0));
  const invite = await L.db.groupInvite.findUniqueOrThrow({ where: { groupId_inviteeId: { groupId: gid, inviteeId: c } } });
  await L.groups.respondGroupInvite(c, invite.id, true, noon(D0));
  await L.db.groupJoinRequest.create({ data: { groupId: gid, userId: c, openKey: `${gid}:${c}` } });
  await L.groups.leaveGroup(c, gid, noon(D1));
  const rc = (await L.links.visibleJoinRequests(gid, admin)).find((r) => r.person.id === c)!;
  await rejects(L.links.decideJoinRequest(admin, rc.id, true, noon(D1)), "together.errors.groupRejoinCooldown");
  await rejects(L.links.requestToJoin(c, token, noon(D1)), "together.errors.groupRejoinCooldown");
  await L.links.decideJoinRequest(admin, rc.id, true, plusDays(noon(D1), 8));
  assert.equal(await L.db.groupMembership.count({ where: { groupId: gid, userId: c, leftAt: null } }), 1);
});

test("rechten: beheerder alles, lid alleen eigen vriend (als het mag), anders niemand", { skip }, async () => {
  const admin = await user("RtAdm");
  const member = await user("RtMem");
  const gid = await newGroup(admin, "Rechten", [member], noon(D0));
  const token = await L.links.enableGroupLink(admin, gid);
  const friendOfMember = await user("RtFr");
  const unknown = await user("RtUnk");
  const outsider = await user("RtOut");
  await befriend(member, friendOfMember);
  await L.links.requestToJoin(friendOfMember, token, noon(D1));
  await L.links.requestToJoin(unknown, token, noon(D1));
  const all = await L.links.visibleJoinRequests(gid, admin);
  const rFriend = all.find((r) => r.person.id === friendOfMember)!;
  const rUnknown = all.find((r) => r.person.id === unknown)!;
  assert.deepEqual(rFriend.friendsInGroup, ["LinkRtMem"], "context: vriend van wie in de groep");

  // Een lid ziet alleen het verzoek van zijn eigen vriend, nooit onbekenden.
  assert.deepEqual((await L.links.visibleJoinRequests(gid, member)).map((r) => r.person.id), [friendOfMember]);
  assert.deepEqual(await L.links.visibleJoinRequests(gid, outsider), []);
  await rejects(L.links.decideJoinRequest(member, rUnknown.id, true, noon(D1)), "together.errors.joinRequestNotAllowed");
  await rejects(L.links.decideJoinRequest(outsider, rFriend.id, true, noon(D1)), "together.errors.joinRequestNotAllowed");

  // Instelling uit: alleen beheerders.
  await L.groups.updateGroupSettings(admin, gid, { membersCanApprove: false });
  assert.deepEqual(await L.links.visibleJoinRequests(gid, member), []);
  await rejects(L.links.decideJoinRequest(member, rFriend.id, true, noon(D1)), "together.errors.joinRequestNotAllowed");
  await L.groups.updateGroupSettings(admin, gid, { membersCanApprove: true });
  await L.links.decideJoinRequest(member, rFriend.id, true, noon(D1));
  await L.links.decideJoinRequest(admin, rUnknown.id, true, noon(D1));
  assert.deepEqual(await memberIds(gid), [admin, member, friendOfMember, unknown].sort());
});

test("meldingen: alleen beheerders en vrienden van de aanvrager, niet de hele groep", { skip }, async () => {
  const admin = await user("NtAdm");
  const others: string[] = [];
  for (let i = 0; i < 6; i++) others.push(await user(`NtM${i}`));
  const gid = await newGroup(admin, "Meldingen", others, noon(D0));
  const token = await L.links.enableGroupLink(admin, gid);
  const asker = await user("NtAsk");
  await befriend(asker, others[0]);
  assert.deepEqual((await L.links.joinRequestRecipients(L.db, gid, asker)).sort(), [admin, others[0]].sort());
  await L.links.requestToJoin(asker, token, noon(D1));
  await eventually(async () => (await notes(admin)).some((n) => n.body.includes("LinkNtAsk")));
  await eventually(async () => (await notes(others[0])).some((n) => n.body.includes("LinkNtAsk")));
  for (const id of others.slice(1)) assert.ok(!(await notes(id)).some((n) => n.body.includes("LinkNtAsk")), "geen melding voor andere leden");
  await L.groups.updateGroupSettings(admin, gid, { membersCanApprove: false });
  assert.deepEqual(await L.links.joinRequestRecipients(L.db, gid, asker), [admin]);
});

test("privacy: link maakt een groep niet openbaar en een openbare groep heeft geen link", { skip }, async () => {
  const admin = await user("PrAdm");
  const m = await user("PrM");
  const gid = await newGroup(admin, "Besloten", [m], noon(D0));
  const outsider = await user("PrOut");
  await L.links.enableGroupLink(admin, gid);
  assert.equal(await L.views.publicGroup(gid), null);
  assert.equal((await L.views.groupLeaderboard("streak", outsider, 1000)).some((g) => g.id === gid), false);
  assert.equal(await L.views.groupDetail(gid, outsider, null), null, "geen ledenlijst voor buitenstaanders");
  // Andersom: openbaar maken zet geen link aan.
  const open = await newGroup(admin, "Open", [m], noon(D0));
  await L.groups.updateGroupSettings(admin, open, { showOnLeaderboard: true });
  assert.equal((await L.db.socialGroup.findUniqueOrThrow({ where: { id: open } })).joinLinkToken, null);
  // Een lid ziet de link niet; alleen een beheerder.
  assert.equal((await L.views.groupDetail(gid, m, null))!.joinLink, null);
  assert.ok((await L.views.groupDetail(gid, admin, null))!.joinLink);
});

// --- Persoonlijke pushmeldingen bij geschonken bevriezingen ------------------

test("bevriezing: aanbieder krijgt een persoonlijke push, de groep geen pushstorm", { skip }, async () => {
  const donor = await user("FzDon", { freezeCount: 2, push: true });
  const others = [await user("FzA", { push: true }), await user("FzB", { push: true }), await user("FzC", { push: true })];
  const gid = await newGroup(donor, "Bevriezing", others, noon(D0));
  // De uitnodigingen uit de opzet geven elk een push; die eerst laten landen.
  await eventually(async () => others.every((id) => pushedTo(id) === 1));

  // Niet nodig: push naar de aanbieder, verder niemand.
  pushes.length = 0;
  await L.freeze.offerGroupFreeze(donor, gid, noon(D1));
  for (const id of [donor, others[0], others[1]]) await L.db.streakDay.create({ data: { userId: id, dayKey: D1, status: "STUDIED" } });
  await L.streak.refreshGroup(gid, noon(D1));
  await eventually(async () => pushedTo(donor) === 1);
  assert.deepEqual(others.map(pushedTo), [0, 0, 0]);

  // Wel gebruikt: push naar de aanbieder; de rest alleen in het meldingencentrum.
  pushes.length = 0;
  await L.freeze.offerGroupFreeze(donor, gid, noon(D2));
  await L.streak.refreshGroup(gid, morningAfter(D1));
  await L.streak.refreshGroup(gid, morningAfter(D2));
  await eventually(async () => pushedTo(donor) === 1);
  await eventually(async () => (await notes(others[2])).some((n) => n.kind === "groups" && n.body.includes("Bevriezing")));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(others.map(pushedTo), [0, 0, 0], "geen push naar alle groepsleden");
  assert.equal(pushedTo(donor), 1);
});

// --- Minuuttaak ---------------------------------------------------------------

test("minuuttaak: alleen groepen en vriendenreeksen die aan de beurt zijn, beheerders alleen bij twijfel", { skip }, async () => {
  const admin = await user("WkAdm");
  const a = await user("WkA");
  const b = await user("WkB");
  const gid = await newGroup(admin, "Worker", [a, b], noon(D0));
  const g = await L.db.socialGroup.findUniqueOrThrow({ where: { id: gid } });
  // Volgende controle pas als 2 juni voor iedereen voorbij is (Nederland: 22:00 UTC).
  assert.equal(g.nextCheckAt.toISOString(), "2032-06-02T22:00:00.000Z");
  const dueAt = (now: Date) => L.db.socialGroup.count({ where: { id: gid, nextCheckAt: { lte: now } } });
  assert.equal(await dueAt(noon(D1)), 0, "midden op de dag niet aan de beurt");
  assert.equal(await dueAt(morningAfter(D1)), 1);

  // Een vriendenreeks wordt na een ronde pas weer bekeken als de dag kan aflopen.
  await befriend(a, b);
  const { id } = await L.friends.inviteFriendStreak(a, b);
  await L.friends.respondFriendStreak(b, id, true, noon(D1));
  const s = await L.db.friendStreak.findUniqueOrThrow({ where: { id } });
  assert.equal(s.nextCheckAt.toISOString(), "2032-06-02T22:00:00.000Z");

  // Beheerders: actieve beheerder = geen kandidaat; pas na 14 dagen zonder studie wel.
  await L.db.streakDay.create({ data: { userId: admin, dayKey: D1, status: "STUDIED" } });
  assert.equal((await L.groups.adminMaintenanceCandidates(noon(D2))).includes(gid), false);
  assert.equal((await L.groups.adminMaintenanceCandidates(plusDays(noon(D1), 16))).includes(gid), true);
});
