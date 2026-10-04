import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import { userTimeZone, zonedParts } from "@/lib/timeZone";
import { getStreakContinuation } from "@/lib/streakContinuation";
import { getTextOfTheDay, type DailyText } from "@/lib/dailyText";
import { wordGamePeriod } from "@/lib/wordGame";
import { getActiveGameStatus, type ActivityItem } from "@/lib/activeGames";
import { getSubscribedCourseSummaries } from "@/lib/courseSummaries";
import { BOFM_WORK, getContentContext } from "@/lib/contentCollections";
import { getGameSettings } from "@/lib/gameSettings";
import { GAME_CATALOG, isGameVisible, type GameCatalogEntry } from "@/lib/gameCatalog";
import { getFriendStatusMap } from "@/lib/presence";
import { applyPersonalOrder } from "@/lib/listOrder";
import { localizedCourse } from "@/lib/courseText";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { getT } from "@/lib/i18n";
import { courseArtworkKeys, gameArtworkKeys, podcastArtworkKeys } from "@/lib/artwork";
import { getTogetherSummary, type TogetherSummary } from "@/lib/social/together";

// Alle gegevens voor Vandaag (src/app/dashboard/page.tsx), in één keer en
// parallel opgehaald. Elke bron is bestaande functionaliteit: de open
// spellen uit activeGames.ts, de cursusvoortgang uit courseSummaries.ts,
// aanwezigheid via presence.ts (met alle privacyregels), de dagelijkse
// spellen uit hun eigen tabellen. Hier komt niets bij dat een andere pagina
// anders zou laten zien.

export type OpenActionKind = "friend-request" | "invite" | "live-invite" | "turn" | "live" | "solo";

export interface OpenAction {
  key: string;
  kind: OpenActionKind;
  game: ActivityItem["kind"] | null;
  person: { id: string; handle: string } | null;
  /** Waar het over gaat: een hoofdstuk ("Alma 32") of de naam van het spel. */
  subject: string;
  at: string | null;
  href: string;
  friendshipId?: string;
}

export interface ContinueItem {
  key: string;
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
export function isTodayComplete(data: Pick<TodayData, "streak" | "actions" | "wordGame" | "dailyQuiz">): boolean {
  return (
    data.streak.studiedToday &&
    data.actions.length === 0 &&
    [data.wordGame, data.dailyQuiz].every((game) => game === null || game.status === "done")
  );
}

const MAX_ACTIONS = 6;
const MAX_CONTINUE = 8;
const MAX_DISCOVER = 6;

function partOfDay(timeZone: string): TodayData["partOfDay"] {
  const hour = zonedParts(new Date(), timeZone).hour;
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function byNewest<T extends { at: string | null }>(a: T, b: T): number {
  return (b.at ?? "").localeCompare(a.at ?? "");
}

function openActions(status: Awaited<ReturnType<typeof getActiveGameStatus>>, friendRequests: { id: string; createdAt: Date; sender: { id: string; handle: string } }[]): OpenAction[] {
  const person = (item: ActivityItem) => (item.opponentId && item.opponentName ? { id: item.opponentId, handle: item.opponentName } : null);
  const requests: OpenAction[] = friendRequests.map((request) => ({
    key: `friend-${request.id}`,
    kind: "friend-request",
    game: null,
    person: request.sender,
    subject: "",
    at: request.createdAt.toISOString(),
    href: "/friends",
    friendshipId: request.id,
  }));
  const invites: OpenAction[] = [
    ...status.liveInvitesReceived.map((item) => ({ item, kind: "live-invite" as const })),
    ...status.invitesReceived.map((item) => ({ item, kind: "invite" as const })),
  ]
    .map(({ item, kind }) => ({
      key: `${kind}-${item.kind}-${item.id}`,
      kind,
      game: item.kind,
      person: person(item),
      subject: item.label,
      at: item.at,
      href: item.playLink ?? item.link,
    }))
    .sort(byNewest);
  // Alleen wat op jou wacht: een beurt bij een tegenstander is geen actie.
  const turns: OpenAction[] = status.activeGames
    .filter((item) => item.myTurn === true || item.kind === "live" || item.kind === "chapter-guess-solo")
    .map((item) => ({
      key: `turn-${item.kind}-${item.id}`,
      kind: item.kind === "live" ? ("live" as const) : item.kind === "chapter-guess-solo" ? ("solo" as const) : ("turn" as const),
      game: item.kind,
      person: person(item),
      subject: item.label,
      at: item.at,
      href: item.playLink ?? item.link,
    }))
    .sort(byNewest);
  return [...requests, ...invites, ...turns].slice(0, MAX_ACTIONS);
}

export async function getTodayData(user: User): Promise<TodayData> {
  const continuation = await getStreakContinuation(user.id);
  const t = getT(user.uiLanguage);
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
    gameStatus,
    friendRequests,
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
  ] = await Promise.all([
    getActiveGameStatus(user),
    prisma.friendship.findMany({
      where: { receiverId: user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIONS,
      select: { id: true, createdAt: true, sender: { select: { id: true, handle: true } } },
    }),
    getSubscribedCourseSummaries(user, contentContext.active.id, t),
    // De kleine leeslessen houden hun plek bij als les, niet als hoofdstuk.
    prisma.userCourseProgress.findMany({
      where: { userId: user.id, subscribed: true, currentLessonId: { not: null } },
      select: {
        courseId: true,
        currentLesson: { select: { startVerse: true, endVerse: true, chapter: { select: { number: true, book: { select: { name: true, key: true } } } } } },
      },
    }),
    prisma.podcastPlaybackProgress.findMany({
      where: { userId: user.id, positionSeconds: { gt: 0 } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: {
        positionSeconds: true,
        updatedAt: true,
        episode: { select: { id: true, number: true, title: true, podcastId: true, podcast: { select: { name: true, courses: { select: { id: true }, take: 1 } } } } },
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
  ]);

  const visibleGame = (id: string) => {
    const game = GAME_CATALOG.find((g) => g.id === id);
    return game && isGameVisible(game, settings, contentContext.gameKeys, user.isAdmin) ? game : null;
  };

  // Ga verder: cursussen waar je al mee bezig bent, en podcasts die je half
  // beluisterd hebt, samen op laatste activiteit.
  const lessonByCourse = new Map(readingPositions.map((p) => [p.courseId, p.currentLesson]));
  const courseItems: ContinueItem[] = courses
    .filter((course) => course.lastActivityAt && (course.completedCount > 0 || course.currentChapter || lessonByCourse.get(course.id)))
    .map((course) => {
      const lesson = lessonByCourse.get(course.id);
      const position = lesson
        ? `${lesson.chapter.book.name} ${lesson.chapter.number}:${lesson.startVerse}-${lesson.endVerse}`
        : course.currentChapter
          ? `${course.currentChapter.bookName} ${course.currentChapter.number}`
          : null;
      return {
        key: `course-${course.id}`,
        kind: "course",
        title: course.name,
        position,
        positionSeconds: null,
        progress: course.totalChapters > 0 ? { done: course.completedCount, total: course.totalChapters, unitPlural: course.unitPlural } : null,
        href: `/courses/${course.id}`,
        context: contentContext.active.name,
        at: course.lastActivityAt!,
        // Het beeld volgt het boek waar je nu bent (bv. Alma), niet alleen de cursus.
        artwork: courseArtworkKeys({ slug: course.slug, type: course.type, work: course.work, bookKey: lesson?.chapter.book.key ?? course.currentChapter?.bookKey }),
      };
    });
  const podcastItems: ContinueItem[] = podcastPositions
    .filter((p) => p.episode.podcast.courses[0])
    .map((p) => ({
      key: `podcast-${p.episode.id}`,
      kind: "podcast",
      title: t("player.episode", { n: p.episode.number, title: p.episode.title }),
      position: null,
      positionSeconds: Math.round(p.positionSeconds),
      progress: null,
      href: `/courses/${p.episode.podcast.courses[0].id}`,
      context: p.episode.podcast.name,
      at: p.updatedAt.toISOString(),
      artwork: podcastArtworkKeys(p.episode.podcastId),
    }));
  const continueItems = [...courseItems, ...podcastItems].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_CONTINUE);

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
      title: t(game.titleKey),
      description: null,
      href: game.href,
      meta: null,
      gameTextKey: game.textKey,
      artwork: gameArtworkKeys(game.id),
    }));
  // Afwisselend een cursus en een spel, zodat beide soorten zichtbaar zijn
  // ook als er van één soort veel is.
  const discover: DiscoverItem[] = [];
  for (let i = 0; discover.length < MAX_DISCOVER && (i < courseCards.length || i < gameCards.length); i++) {
    if (courseCards[i]) discover.push(courseCards[i]);
    if (gameCards[i] && discover.length < MAX_DISCOVER) discover.push(gameCards[i]);
  }

  return {
    firstName: user.handle,
    timeZone,
    partOfDay: partOfDay(timeZone),
    streak: { current: continuation.currentStreak, studiedToday: continuation.studiedToday, interrupted: continuation.status === "INTERRUPTED" },
    actions: openActions(gameStatus, friendRequests),
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
