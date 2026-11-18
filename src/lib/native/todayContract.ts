import { z } from "zod";
import type { TodayData } from "@/lib/today";
import type { TodayProgram } from "@/components/today/TodayProgramView";
const text = z.string().max(4000), id = z.string().min(1).max(128), count = z.number().int().nonnegative();
const href = z.string().max(1024).refine(value => !/[\\\u0000-\u0020\u007f]/.test(value)).regex(/^\/(?!\/)[A-Za-z0-9_/?=&%#.,:~-]*$/);
const person = z.object({ id, handle: text });
const progress = z.object({ done: count, total: count, unitPlural: text });
const game = z.object({ href, status: z.enum(["todo", "in-progress", "done"]), won: z.boolean().optional(), dayKey: text.optional(), nextReleaseAt: z.iso.datetime().optional() });
const avatar = z.object({ avatarEmoji: text.nullable(), avatarCharacterId: id.nullable(), avatarBackgroundId: id.nullable(), avatarFrameId: id.nullable(), avatarDecorationId: id.nullable(), avatarLightAccentId: id.nullable() });
const togetherPerson = person.extend({ discriminator: text, avatarEmoji: text.nullable() });
const together = z.object({ friendStreaks: z.object({ active: count, limit: count, longest: count }), groups: z.object({ count: count, longest: count }), invites: count, highlights: z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("friend-waiting"), friend: togetherPerson, streak: count }),
  z.object({ kind: z.literal("group-missing"), groupId: id, name: text, missing: count }),
  z.object({ kind: z.literal("group-protected"), groupId: id, name: text, by: togetherPerson }),
  z.object({ kind: z.literal("group-achieved"), groupId: id, name: text, contributors: count }),
])).max(3) });
export const todayDataSchema = z.object({
  firstName: text, timeZone: z.string().max(100).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }), partOfDay: z.enum(["morning", "afternoon", "evening", "night"]),
  streak: z.object({ current: count, studiedToday: z.boolean(), interrupted: z.boolean().optional() }),
  actions: z.array(z.object({ key: text, tab: z.enum(["required", "continue", "waiting"]), kind: z.enum(["friend-request", "group-invite", "group-request", "game-invite", "live-invite", "game-turn", "game-continue", "game-waiting"]), at: z.iso.datetime(), person: person.nullable(), subject: text, href, contentCollectionId: id.optional(), game: text.optional(), gameCode: text.optional(), actionId: id.optional(), groupId: id.optional() })).max(10), actionTotal: count,
  continueItems: z.array(z.object({ key: text, visibilityKey: text, kind: z.enum(["course", "podcast"]), title: text, position: text.nullable(), positionSeconds: z.number().nonnegative().nullable(), progress: progress.nullable(), href, context: text, at: z.iso.datetime(), artwork: z.array(text).max(20) })).max(3),
  dailyText: z.object({ href, reference: text, sourceName: text, bookName: text.nullable(), chapterNumber: count.nullable(), verseNumber: count.nullable(), text }).nullable(), sundayHymns: z.boolean(), wordGame: game.nullable(), dailyQuiz: game.nullable(),
  social: z.object({ friends: z.array(person.extend({ avatarEmoji: text.nullable() })).max(5000), online: z.record(id, text.nullable()), viewerSharesOnline: z.boolean() }), together: together.nullable(),
  discover: z.array(z.object({ key: text, kind: z.enum(["course", "game"]), title: text, description: text.nullable(), href, meta: text.nullable(), gameTextKey: text.optional(), artwork: z.array(text).max(20) })).max(6),
}).transform(value => value as TodayData);
const week = z.object({ lessonId: id, collectionId: id, title: text, startsOn: text.nullable(), endsOnExclusive: text.nullable(), imageMediaId: id.nullable(), started: z.boolean() });
const program = z.object({ token: text, body: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cfm"), props: z.object({ programName: text, mode: z.enum(["FREE", "STEPS"]), weeksHref: href, resumeReason: z.enum(["calendar", "selected", "studied"]).nullable(), week: week.nullable() }) }),
  z.object({ kind: z.literal("summary"), props: z.object({ programName: text, personalMode: z.enum(["FREE", "STEPS"]).nullable(), context: z.object({ activeLessonKey: text.nullable(), available: z.boolean(), lessonHref: href.nullable() }), active: z.object({ title: text, read: z.boolean() }).nullable(), currentLesson: z.object({ lessonId: id, collectionId: id, title: text }).nullable(), personalProgram: z.boolean() }) }),
]) }).nullable().transform(value => value as TodayProgram);
export const nativeTodayOverviewSchema = z.object({ version: z.literal(1), userId: id, activeCollectionId: id.nullable(), selectionVersion: count, language: z.enum(["nl", "en", "de", "fr", "es"]), companion: z.enum(["novi", "varo", "vera"]), serverNow: z.number().int().positive(), expiresAt: z.iso.datetime(), countdownEnabled: z.boolean(), kompasNew: z.boolean(),
  continuation: z.object({ status: z.enum(["ACTIVE", "INTERRUPTED"]), currentStreak: count, day: text, interruptedDay: text.nullable(), completed: count, required: count, studiedToday: z.boolean() }),
  program, avatars: z.record(id, avatar), data: todayDataSchema,
}).strict();
export type NativeTodayOverview = z.infer<typeof nativeTodayOverviewSchema>;
