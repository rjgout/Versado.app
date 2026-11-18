// Gelijktijdige verzoeken in beide richtingen mogen nooit twee Friendship-rijen opleveren.
//   LEARNING_TEST_DATABASE_URL=postgresql://... tsx --test tests/friend-request-race.integration.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";
let db: typeof import("../src/lib/db")["prisma"];
let pair: typeof import("../src/lib/social/friendshipPair");
const ids: string[] = [];
let seq = 0;
const mk = async (n: string) => { seq++; const u = await db.user.create({ data: { email: `${n}-${Date.now()}-${Math.random()}@race.invalid`, handle: `${n}${seq}`, discriminator: "55", passwordHash: "x" } }); ids.push(u.id); return u; };

before(async () => { if (skip) return; db = (await import("../src/lib/db")).prisma; pair = await import("../src/lib/social/friendshipPair"); }, { timeout: 30000 });
after(async () => { if (skip) return; await db.friendship.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } }); await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); });

test("A→B en B→A tegelijk geeft precies één rij (25 rondes)", { skip, timeout: 120000 }, async () => {
  for (let round = 0; round < 25; round++) {
    const a = await mk("RaceA"), b = await mk("RaceB");
    const results = await Promise.all([
      db.$transaction(tx => pair.createFriendRequestOnce(tx, a.id, b.id)),
      db.$transaction(tx => pair.createFriendRequestOnce(tx, b.id, a.id)),
    ]);
    assert.equal(results.filter(r => r.created).length, 1, `ronde ${round}`);
    assert.equal(await db.friendship.count({ where: { OR: [{ senderId: a.id, receiverId: b.id }, { senderId: b.id, receiverId: a.id }] } }), 1);
  }
});

test("dubbel verzoek in dezelfde richting blijft één rij; bestaande relatie wordt gemeld", { skip, timeout: 60000 }, async () => {
  const a = await mk("DupA"), b = await mk("DupB");
  const r = await Promise.all([1, 2, 3, 4].map(() => db.$transaction(tx => pair.createFriendRequestOnce(tx, a.id, b.id))));
  assert.equal(r.filter(x => x.created).length, 1);
  const again = await db.$transaction(tx => pair.createFriendRequestOnce(tx, b.id, a.id));
  assert.equal(again.created, false);
});

test("uitnodigingslink en wederzijds verzoek tegelijk: één rij, geaccepteerd", { skip, timeout: 60000 }, async () => {
  const { becomeFriendsViaInvite } = await import("../src/lib/friendInvite");
  const inviter = await db.user.create({ data: { email: `inv-${Date.now()}@race.invalid`, handle: "Inviter", discriminator: "77", passwordHash: "x", inviteCode: `race${Date.now()}` } });
  ids.push(inviter.id);
  const joiner = await mk("Joiner");
  const code = inviter.inviteCode!;
  await Promise.all([
    becomeFriendsViaInvite(code, joiner.id, { isNewAccount: false }),
    db.$transaction(tx => pair.createFriendRequestOnce(tx, joiner.id, inviter.id)),
  ]);
  const rows = await db.friendship.findMany({ where: { OR: [{ senderId: inviter.id, receiverId: joiner.id }, { senderId: joiner.id, receiverId: inviter.id }] } });
  assert.equal(rows.length, 1);
});
