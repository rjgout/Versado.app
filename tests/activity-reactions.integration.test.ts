import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

let db: Awaited<ReturnType<typeof load>>["db"];
const userIds: string[] = [];
const itemIds: string[] = [];

async function load() {
  return { db: (await import("../src/lib/db")).prisma, run: (await import("../src/lib/activityReactionNotifications")).runActivityReactionNotificationTick };
}

before(async () => {
  if (!url) return;
  db = (await load()).db;
});

after(async () => {
  if (!db) return;
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

test("reactiebatch: geen directe melding, één batch per activiteit en nieuwe batch na verzending", { skip }, async () => {
  const { run } = await load();
  const owner = await db.user.create({
    data: { email: `reaction-owner-${Date.now()}@test.invalid`, passwordHash: "x", handle: "Owner", discriminator: "01", uiLanguage: "nl", notifyActivityReactions: true },
  });
  const anna = await db.user.create({ data: { email: `reaction-anna-${Date.now()}@test.invalid`, passwordHash: "x", handle: "Anna", discriminator: "02" } });
  const peter = await db.user.create({ data: { email: `reaction-peter-${Date.now()}@test.invalid`, passwordHash: "x", handle: "Peter", discriminator: "03" } });
  userIds.push(owner.id, anna.id, peter.id);
  const item = await db.activityFeedItem.create({ data: { userId: owner.id, kind: "XP", groupKey: "test", xpAmount: 5 } });
  itemIds.push(item.id);
  const first = new Date("2032-01-01T12:00:00Z");
  const batch = await db.activityReactionNotificationBatch.create({
    data: { itemId: item.id, recipientUserId: owner.id, firstReactionAt: first, sendAfter: new Date(first.getTime() + 15 * 60 * 1000) },
  });
  await db.activityFeedReaction.createMany({
    data: [
      { itemId: item.id, userId: anna.id, emoji: "🫶🏻", notificationBatchId: batch.id },
      { itemId: item.id, userId: peter.id, emoji: "🎉", notificationBatchId: batch.id },
    ],
  });

  assert.equal(await db.notification.count({ where: { userId: owner.id } }), 0);
  await run(new Date("2032-01-01T12:16:00Z"));
  const notifications = await db.notification.findMany({ where: { userId: owner.id } });
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].body, /Anna#02/);
  assert.match(notifications[0].body, /Peter#03/);

  await run(new Date("2032-01-01T12:17:00Z"));
  assert.equal(await db.notification.count({ where: { userId: owner.id } }), 1);

  const secondItem = await db.activityFeedItem.create({ data: { userId: owner.id, kind: "XP", groupKey: "other", xpAmount: 2 } });
  itemIds.push(secondItem.id);
  const secondBatch = await db.activityReactionNotificationBatch.create({
    data: { itemId: secondItem.id, recipientUserId: owner.id, firstReactionAt: first, sendAfter: new Date(first.getTime() + 15 * 60 * 1000) },
  });
  await db.activityFeedReaction.create({ data: { itemId: secondItem.id, userId: anna.id, emoji: "❤️", notificationBatchId: secondBatch.id } });
  await run(new Date("2032-01-01T12:32:00Z"));
  assert.equal(await db.notification.count({ where: { userId: owner.id } }), 2);
});

test("reactiebatch: uitgeschakelde voorkeur maakt geen melding", { skip }, async () => {
  const { run } = await load();
  const owner = await db.user.create({
    data: { email: `reaction-off-${Date.now()}@test.invalid`, passwordHash: "x", handle: "Uit", discriminator: "04", uiLanguage: "nl", notifyActivityReactions: false },
  });
  const actor = await db.user.create({ data: { email: `reaction-actor-${Date.now()}@test.invalid`, passwordHash: "x", handle: "Actor", discriminator: "05" } });
  userIds.push(owner.id, actor.id);
  const item = await db.activityFeedItem.create({ data: { userId: owner.id, kind: "XP", groupKey: "test", xpAmount: 1 } });
  itemIds.push(item.id);
  const at = new Date("2032-02-01T12:00:00Z");
  const batch = await db.activityReactionNotificationBatch.create({ data: { itemId: item.id, recipientUserId: owner.id, firstReactionAt: at, sendAfter: new Date(at.getTime() - 1) } });
  await db.activityFeedReaction.create({ data: { itemId: item.id, userId: actor.id, emoji: "🙌", notificationBatchId: batch.id } });
  await run(new Date("2032-02-01T12:01:00Z"));
  assert.equal(await db.notification.count({ where: { userId: owner.id } }), 0);
});
