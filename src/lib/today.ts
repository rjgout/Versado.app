import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import { userTimeZone, zonedParts } from "@/lib/timeZone";
import { getStreakContinuation } from "@/lib/streakContinuation";
import { getTextOfTheDay, type DailyText } from "@/lib/dailyText";
import { wordGamePeriod } from "@/lib/wordGame";
import { getSubscribedCourseSummaries } from "@/lib/courseSummaries";
import { BOFM_WORK, getContentContext } from "@/lib/contentCollections";
import { getGameSettings } from "@/lib/gameSettings";
import { GAME_CATALOG, gameTitle, isGameVisible, type GameCatalogEntry } from "@/lib/gameCatalog";
import { getFriendStatusMap } from "@/lib/presence";
import { applyPersonalOrder } from "@/lib/listOrder";
import { localizedCourse } from "@/lib/courseText";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { getT } from "@/lib/i18n";
import { courseArtworkKeys, gameArtworkKeys, podcastArtworkKeys } from "@/lib/artwork";
import { companionToMascot } from "@/lib/companion";
import { getTogetherSummary, type TogetherSummary } from "@/lib/social/together";
import { compactOpenActions, getOpenActions, type OpenAction } from "@/lib/openActions";
import { introResumeHref, kidsResumeHref, podcastResumeHref, readingResumeHref } from "@/lib/courseResume";

// Alle gegevens voor Vandaag (src/app/dashboard/page.tsx), in één keer en
// parallel opgehaald. Elke bron is bestaande functionaliteit: de open
// spellen uit activeGames.ts, de cursusvoortgang uit courseSummaries.ts,
// aanwezigheid via presence.ts (met alle privacyregels), de dagelijkse
// spellen uit hun eigen tabellen. Hier komt niets bij dat een andere pagina
// anders zou laten zien.

export type { OpenAction } from "@/lib/openActions";

export interface ContinueItem {
  key: string;
  /** Persoonlijke zichtbaarheid geldt voor deze voortgangstoestand, niet voor de inhoud zelf. */
  visibilityKey: string;
  kind: "course" | "podcast";
  title: string;
  /** Plek in de inhoud: "Alma 32", "Alma 32:1-10" of de luisterpositie in seconden. */
  position: string | null;
  positionSeconds: number | null;
  progress: { done: number; total: number; unitPlural: string } | null;
  href: string;
  /** Naam van de podcast, of het type cursus (vertaald) voor het label. */
  context: string;
  at: string;
  /** Sleutels in het artworkregister (src/lib/artwork.ts), van specifiek naar algemeen. */
  artwork: string[];
}

export interface DailyGameState {
  href: string;
  status: "todo" | "in-progress" | "done";
  won?: boolean;
  /** Alleen voor het dagelijkse woord: hiermee kan een open dashboard om 18:00 (lokaal) verversen. */
  dayKey?: string;
  /** Alleen voor het dagelijkse woord: absoluut moment waarop het volgende woord vrijkomt. */
  nextReleaseAt?: string;
}

export interface FriendSummary {
  id: string;
  handle: string;
  avatarEmoji: string | null;
}

export interface DiscoverItem {
  key: string;
  kind: "course" | "game";
  title: string;
  description: string | null;
  href: string;
  meta: string | null;
  /** Voor spellen: de sleutel in de vertalingen (gamesHub.<textKey>). */
  gameTextKey?: GameCatalogEntry["textKey"];
  artwork: string[];
}

export interface TodayData {
  firstName: string;
  /** IANA-tijdzone van de gebruiker, voor datum en begroeting. */
  timeZone: string;
  partOfDay: "morning" | "afternoon" | "evening" | "night";
  streak: { current: number; studiedToday: boolean; interrupted?: boolean };
  actions: OpenAction[];
  /** Het werkelijke aantal verplichte acties, ook als de compacte kaart er drie toont. */
  actionTotal: number;
  continueItems: ContinueItem[];
  dailyText: DailyText | null;
  wordGame: DailyGameState | null;
  dailyQuiz: DailyGameState | null;
  /** Alle vrienden (voor live bijwerken: een vriend die online komt, moet al bekend zijn) en wie nu online is, met diens gedeelde activiteit. */
  social: { friends: FriendSummary[]; online: Record<string, string | null>; viewerSharesOnline: boolean };
  /** Vriendenreeksen en groepen: alleen wat vandaag telt (null = niets om te tonen). */
  together: TogetherSummary | null;
  discover: DiscoverItem[];
}

/** Alleen afgerond als alle expliciete dagelijkse verplichtingen klaar zijn. */
export function isTodayComplete(data: Pick<TodayData, "streak" | "actions" | "actionTotal" | "wordGame" | "dailyQuiz">): boolean {
  return (
    data.streak.studiedToday &&
    data.actionTotal === 0 &&
    [data.wordGame, data.dailyQuiz].every((game) => game === null || game.status === "done")
  );
}

const MAX_CONTINUE = 3;
const MAX_DISCOVER = 6;

/** Een verborgen kaart blijft weg tot de gebruiker deze inhoud opnieuw gebruikt. */
export function continueVisibilityKey(key: string, activityAt: string): string {
  return `${key}:${activityAt}`;
}

/** De volgorde van Vandaag blijft van de server; dit filtert uitsluitend persoonlijke zichtbaarheid. */
export function visibleContinueItems(items: ContinueItem[], hiddenKeys: ReadonlySet<string>): ContinueItem[] {
  return items.filter((item) => !hiddenKeys.has(item.visibilityKey));
}

/** De server bepaalt relevantie en volgorde; verbergen haalt alleen persoonlijke kaarten weg. */
export function compactContinueItems(items: ContinueItem[], hiddenKeys: ReadonlySet<string>): ContinueItem[] {
  return visibleContinueItems(items, hiddenKeys)
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
    .slice(0, MAX_CONTINUE);
}

function partOfDay(timeZone: string): TodayData["partOfDay"] {
  const hour = zonedParts(new Date(), timeZone).hour;
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export async function getTodayData(user: User): Promise<TodayData> {
  const continuation = await getStreakContinuation(user.id);
  const t = getT(user.uiLanguage);
  const character = companionToMascot(user.companion);
  // De dagelijkse Alleskenner is voor iedereen dezelfde, met één vaste
  // daggrens (UTC); de persoonlijke dag (reeks, begroeting) volgt hieronder
  // de tijdzone van de gebruiker.
  const today = dayKey();
  const timeZone = userTimeZone(user);
  // Het woord van de dag wisselt om 18:00 in de tijdzone van de gebruiker
  // (met servertijd), los van de gewone kalenderdag hieronder.
  const wordPeriod = wordGamePeriod(new Date(), timeZone);
  const wordGameDay = wordPeriod.dayKey;
  const contentContext = await getContentContext(user.id);

  const [
    openActionsData,
    courses,
    readingPositions,
    podcastPositions,
    dailyText,
    settings,
    wordGame,
    dailyQuiz,
    friendships,
    catalog,
    gameOrder,
    continueOrder,
  ] = await Promise.all([
    getOpenActions(user),
    getSubscribedCourseSummaries(user, contentContext.active.id, t),
    // De kleine leeslessen houden hun plek bij als les, niet als hoofdstuk.
    // Alleen de actieve contentcollectie kan op Vandaag worden hervat.
    prisma.userCourseProgress.findMany({
      where: { userId: user.id, subscribed: true, currentLessonId: { not: null }, course: { contentCollectionId: contentContext.active.id } },
      select: {
        courseId: true,
        currentLesson: { select: { id: true, startVerse: true, endVerse: true, chapter: { select: { number: true, book: { select: { name: true, key: true } } } } } },
      },
    }),
    prisma.podcastPlaybackProgress.findMany({
      where: {
        userId: user.id,
        positionSeconds: { gt: 0 },
        episode: { podcast: { courses: { some: { contentCollectionId: contentContext.active.id, type: "PODCAST", enabled: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        positionSeconds: true,
        updatedAt: true,
        episode: {
          select: {
            id: true,
            number: true,
            title: true,
            podcastId: true,
            exercises: { select: { mode: true } },
            progress: { where: { userId: user.id }, select: { mode: true, completed: true } },
            podcast: {
              select: {
                name: true,
                courses: { where: { contentCollectionId: contentContext.active.id, type: "PODCAST", enabled: true }, select: { id: true } },
              },
            },
          },
        },
      },
    }),
    // Gebruik de werkelijk actieve uitgave. Die is de bron van waarheid nadat
    // de contentselector een werk of taal heeft gewisseld; zo blijft de tekst
    // van de dag op Vandaag gelijk aan de gekozen contenttaal.
    getTextOfTheDay(
      new Date(),
      contentContext.active.language,
      contentContext.active.work === BOFM_WORK ? contentContext.active.id : undefined,
    ),
    getGameSettings(),
    prisma.wordGame.findFirst({ where: { userId: user.id, dayKey: wordGameDay }, select: { status: true } }),
    prisma.alleskennerSoloRun.findFirst({ where: { userId: user.id, mode: "DAILY", dayKey: today }, select: { status: true } }),
    prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ senderId: user.id }, { receiverId: user.id }] },
      select: {
        senderId: true,
        sender: { select: { id: true, handle: true, avatarEmoji: true } },
        receiver: { select: { id: true, handle: true, avatarEmoji: true } },
      },
    }),
    prisma.course.findMany({
      where: { enabled: true, contentCollectionId: contentContext.active.id, userProgress: { none: { userId: user.id, subscribed: true } } },
      orderBy: { order: "asc" },
      take: 4,
      include: { _count: { select: { chapters: true } }, book: { select: { slug: true } }, contentCollection: { select: { work: true } } },
    }),
    prisma.userListOrder.findMany({ where: { userId: user.id, listKey: "games" }, orderBy: { order: "asc" }, select: { itemKey: true, hidden: true } }),
    prisma.userListOrder.findMany({ where: { userId: user.id, listKey: "today-continue", hidden: true }, select: { itemKey: true } }),
  ]);

  const visibleGame = (id: string) => {
    const game = GAME_CATALOG.find((g) => g.id === id);
    return game && isGameVisible(game, settings, contentContext.gameKeys, user.isAdmin) ? game : null;
  };

  // Ga verder heeft alleen concrete persoonlijke vervolgstappen. Voor de
  // leesroutes komt de cursor uit UserCourseProgress; kinderverhalen en
  // introlessen volgen hun eigen centrale voortgangsmodellen.
  const lessonByCourse = new Map(readingPositions.map((p) => [p.courseId, p.currentLesson]));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const kidsCourseIds = courses.filter((course) => course.type === "KIDS").map((course) => course.id);
  const introCourse = courses.find((course) => course.type === "INTRO") ?? null;
  const [kidsStories, introLessons] = await Promise.all([
    kidsCourseIds.length > 0
      ? prisma.kidsStory.findMany({
          where: { courseId: { in: kidsCourseIds } },
          orderBy: [{ courseId: "asc" }, { order: "asc" }],
          include: { progress: { where: { userId: user.id }, select: { completed: true, completedAt: true } } },
        })
      : Promise.resolve([]),
    introCourse
      ? prisma.introLesson.findMany({
          orderBy: { number: "asc" },
          include: { progress: { where: { userId: user.id }, select: { completed: true, completedAt: true } } },
        })
      : Promise.resolve([]),
  ]);

  const courseItems: ContinueItem[] = courses.flatMap((course) => {
    const lesson = lessonByCourse.get(course.id);
    const href = readingResumeHref({
      courseId: course.id,
      type: course.type,
      currentChapterId: course.currentChapter?.id ?? null,
      currentLessonId: lesson?.id ?? null,
    });
    // Een nieuw abonnement zet wel een cursor klaar, maar is nog geen echte
    // leeractiviteit. Minstens één afgeronde inhoudsstap houdt deze lijst
    // daarom compact en voorkomt een tweede cursusoverzicht.
    if (!course.lastActivityAt || course.completedCount === 0 || !href) return [];
    const position = lesson
      ? `${lesson.chapter.book.name} ${lesson.chapter.number}:${lesson.startVerse}-${lesson.endVerse}`
      : course.currentChapter
        ? `${course.currentChapter.bookName} ${course.currentChapter.number}`
        : null;
    return [{
      key: `course-${course.id}`,
      visibilityKey: continueVisibilityKey(`course-${course.id}`, course.lastActivityAt),
      kind: "course" as const,
      title: course.name,
      position,
      positionSeconds: null,
      progress: course.totalChapters > 0 ? { done: course.completedCount, total: course.totalChapters, unitPlural: course.unitPlural } : null,
      href,
      context: contentContext.active.name,
      at: course.lastActivityAt,
      // Het beeld volgt het boek waar je nu bent (bv. Alma), niet alleen de cursus.
      artwork: courseArtworkKeys({ slug: course.slug, type: course.type, work: course.work, bookKey: lesson?.chapter.book.key ?? course.currentChapter?.bookKey }),
    }];
  });

  const kidsItems: ContinueItem[] = kidsCourseIds.flatMap((courseId) => {
    const course = courseById.get(courseId);
    const stories = kidsStories.filter((story) => story.courseId === courseId);
    const completed = stories.filter((story) => story.progress[0]?.completed);
    const lastCompletedAt = completed.reduce<Date | null>((latest, story) => {
      const at = story.progress[0]?.completedAt ?? null;
      return at && (!latest || at > latest) ? at : latest;
    }, null);
    const next = stories.find((story) => !story.progress[0]?.completed);
    if (!course || !lastCompletedAt || !next) return [];
    const at = lastCompletedAt.toISOString();
    return [{
      key: `kids-${course.id}`,
      visibilityKey: continueVisibilityKey(`kids-${course.id}`, at),
      kind: "course",
      title: course.name,
      position: `${t("misc.storyN", { n: next.number })} — ${next.title}`,
      positionSeconds: null,
      progress: null,
      href: kidsResumeHref(next.id)!,
      context: contentContext.active.name,
      at,
      artwork: courseArtworkKeys({ slug: course.slug, type: course.type, work: course.work }),
    }];
  });

  const introItems: ContinueItem[] = introCourse ? (() => {
    const completed = introLessons.filter((lesson) => lesson.progress[0]?.completed);
    const lastCompletedAt = completed.reduce<Date | null>((latest, lesson) => {
      const at = lesson.progress[0]?.completedAt ?? null;
      return at && (!latest || at > latest) ? at : latest;
    }, null);
    const next = introLessons.find((lesson) => !lesson.progress[0]?.completed);
    if (!lastCompletedAt || !next) return [];
    const at = lastCompletedAt.toISOString();
    return [{
      key: `intro-${introCourse.id}`,
      visibilityKey: continueVisibilityKey(`intro-${introCourse.id}`, at),
      kind: "course",
      title: introCourse.name,
      position: `${t("lessonFlows.lessonNumber", { n: next.number })} — ${next.title}`,
      positionSeconds: null,
      progress: null,
      href: introResumeHref(next.id)!,
      context: contentContext.active.name,
      at,
      artwork: courseArtworkKeys({ slug: introCourse.slug, type: introCourse.type, work: introCourse.work }),
    }];
  })() : [];

  const podcastItems: ContinueItem[] = podcastPositions.flatMap((playback) => {
    const course = playback.episode.podcast.courses.map((candidate) => courseById.get(candidate.id)).find(Boolean);
    const availableModes = new Set(playback.episode.exercises.map((exercise) => exercise.mode));
    const completedModes = new Set(playback.episode.progress.filter((progress) => progress.completed).map((progress) => progress.mode));
    const mode = (["CONTENT", "BOM_CONNECTION"] as const).find((candidate) => availableModes.has(candidate) && !completedModes.has(candidate));
    if (!course || !mode) return [];
    const at = playback.updatedAt.toISOString();
    return [{
      key: `podcast-${playback.episode.id}`,
      visibilityKey: continueVisibilityKey(`podcast-${playback.episode.id}`, at),
      kind: "podcast",
      title: course.name,
      position: t("player.episode", { n: playback.episode.number, title: playback.episode.title }),
      positionSeconds: Math.round(playback.positionSeconds),
      progress: null,
      href: podcastResumeHref(playback.episode.id, mode)!,
      context: playback.episode.podcast.name,
      at,
      artwork: podcastArtworkKeys(playback.episode.podcastId),
    }];
  });
  const hiddenContinue = new Set(continueOrder.map((row) => row.itemKey));
  const continueItems = compactContinueItems([...courseItems, ...kidsItems, ...introItems, ...podcastItems], hiddenContinue);

  const wordGameEntry = visibleGame("word-game");
  const quizEntry = visibleGame("alleskenner");

  // Aanwezigheid alleen via presence.ts: dat past incognito, "online-status
  // delen" en "activiteit delen" toe, en toont niets als je je eigen status
  // niet deelt (zelfde regel als de vriendenpagina).
  // Daarna houdt de pagina dit live bij via de socketserver (SocialLive.tsx),
  // die dezelfde regels toepast.
  const friends: FriendSummary[] = friendships
    .map((f) => (f.senderId === user.id ? f.receiver : f.sender))
    .sort((a, b) => a.handle.localeCompare(b.handle));
  const [statusMap, together] = await Promise.all([
    getFriendStatusMap(friends.map((f) => f.id), user.shareOnlineStatus),
    // Een fout in Samen mag Vandaag nooit blokkeren.
    getTogetherSummary(user.id, user.timeZone).catch((e) => {
      console.error("Samen op Vandaag:", e);
      return null;
    }),
  ]);
  const online: Record<string, string | null> = Object.fromEntries(
    friends.filter((f) => statusMap[f.id]?.online).map((f) => [f.id, statusMap[f.id]?.activity?.label ?? null])
  );

  // Voor jou: nog niet toegevoegde cursussen bij de actieve content en de
  // spellen in je eigen volgorde. De dagelijkse spellen staan al bij Vandaag.
  // Een spel dat je op Spelen verborg, raden we hier ook niet aan.
  const hiddenGames = new Set(gameOrder.filter((o) => o.hidden).map((o) => o.itemKey));
  const games = applyPersonalOrder(
    GAME_CATALOG.filter((g) => !["word-game", "alleskenner"].includes(g.id) && visibleGame(g.id) && !hiddenGames.has(g.id)),
    gameOrder.filter((o) => !o.hidden).map((o) => o.itemKey)
  ).slice(0, MAX_DISCOVER);
  const courseCards: DiscoverItem[] = catalog.map((course) => {
      const text = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage);
      const unit = localizeTerm(chapterTerm(course.book?.slug, course.contentCollectionId), t).plural;
      return {
        key: `course-${course.id}`,
        kind: "course" as const,
        title: text.name,
        description: text.description,
        href: "/courses",
        meta: course._count.chapters > 0 ? `${course._count.chapters} ${unit}` : null,
        artwork: courseArtworkKeys({ slug: course.slug, type: course.type, work: course.contentCollection.work }),
      };
    });
  const gameCards: DiscoverItem[] = games.map((game) => ({
      key: `game-${game.id}`,
      kind: "game" as const,
      title: gameTitle(t, game, character),
      description: null,
      href: game.href,
      meta: null,
      gameTextKey: game.textKey,
      artwork: gameArtworkKeys(game.id, character),
    }));
  // Afwisselend een cursus en een spel, zodat beide soorten zichtbaar zijn
  // ook als er van één soort veel is.
  const discover: DiscoverItem[] = [];
  for (let i = 0; discover.length < MAX_DISCOVER && (i < courseCards.length || i < gameCards.length); i++) {
    if (courseCards[i]) discover.push(courseCards[i]);
    if (gameCards[i] && discover.length < MAX_DISCOVER) discover.push(gameCards[i]);
  }
  const compactActions = compactOpenActions(openActionsData, "required");

  return {
    firstName: user.handle,
    timeZone,
    partOfDay: partOfDay(timeZone),
    streak: { current: continuation.currentStreak, studiedToday: continuation.studiedToday, interrupted: continuation.status === "INTERRUPTED" },
    actions: compactActions.actions,
    actionTotal: compactActions.total,
    continueItems,
    dailyText,
    wordGame: wordGameEntry
      ? { href: wordGameEntry.href, dayKey: wordGameDay, nextReleaseAt: wordPeriod.nextReleaseAt.toISOString(), status: !wordGame ? "todo" : wordGame.status === "IN_PROGRESS" ? "in-progress" : "done", won: wordGame?.status === "WON" }
      : null,
    dailyQuiz: quizEntry
      ? { href: "/alleskenner/alleen", status: !dailyQuiz ? "todo" : dailyQuiz.status === "IN_PROGRESS" ? "in-progress" : "done" }
      : null,
    social: { friends, online, viewerSharesOnline: user.shareOnlineStatus },
    together,
    discover,
  };
}
