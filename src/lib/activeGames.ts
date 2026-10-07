import { prisma } from "@/lib/db";
import { getContentContext } from "@/lib/contentCollections";
import { getT } from "@/lib/i18n";
import { localizedCourse } from "@/lib/courseText";
import type { CourseType } from "@/generated/prisma/client";

// Alles wat een gebruiker "open" heeft staan over de asynchrone spellen
// heen (Uitdagingen, Woordspel), het realtime Live spel, en een eigen
// "Raad het hoofdstuk"-potje (alleen spelen) dat nog niet is uitgespeeld:
// openstaande uitnodigingen (ontvangen/verstuurd) en partijen die nog
// lopen. Eén bron voor /api/activity-status (ActiveGamesBanner op /live)
// en de open acties op Vandaag, zodat die nooit uiteenlopen.
//
// Geen next/headers: de aanroeper geeft de gebruiker mee.

export interface ActivityItem {
  kind: "challenge" | "scrabble" | "live" | "chapter-guess-solo";
  id: string;
  opponentName: string | null;
  opponentId: string | null;
  label: string;
  link: string;
  myTurn: boolean | null;
  contentCollectionId?: string;
  // Alleen gezet bij kind "live": de speelcode, nodig om cancel_game te
  // kunnen versturen (zie ActiveGamesBanner) zonder eerst naar de lobby te
  // navigeren.
  code?: string;
  /** Wanneer dit begon of voor het laatst veranderde (ISO), voor "2 uur geleden". */
  at: string;
  /** Rechtstreeks spelen, als dat kan (uitdaging: de les met challengeId). */
  playLink?: string;
}

export interface ActiveGameStatus {
  liveInvitesReceived: ActivityItem[];
  invitesReceived: ActivityItem[];
  invitesSent: ActivityItem[];
  activeGames: ActivityItem[];
  activeContentCollectionId: string;
}

export async function getActiveGameStatus(user: { id: string; uiLanguage: string | null }): Promise<ActiveGameStatus> {
  const t = getT(user.uiLanguage);
  const studyLabel = (course: { type: CourseType; name: string; description: string | null; contentCollection: { work: string | null } }) =>
    t("study.inviteLabel", { course: localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name });

  const [challenges, scrabbleGames, liveGames, soloChapterGuessGames, gameScopes, contentContext, receivedLiveInvites] = await Promise.all([
    prisma.challenge.findMany({
      where: { OR: [{ senderId: user.id }, { receiverId: user.id }], status: { in: ["PENDING", "ACCEPTED"] } },
      include: {
        sender: { select: { id: true, handle: true } },
        receiver: { select: { id: true, handle: true } },
        chapter: { include: { book: true } },
      },
    }),
    prisma.scrabbleGame.findMany({
      where: { OR: [{ player1Id: user.id }, { player2Id: user.id }], status: { in: ["PENDING", "ACTIVE"] } },
      include: {
        player1: { select: { id: true, handle: true } },
        player2: { select: { id: true, handle: true } },
      },
    }),
    prisma.liveGame.findMany({
      where: {
        status: { in: ["LOBBY", "IN_PROGRESS"] },
        OR: [{ hostId: user.id }, { players: { some: { userId: user.id } } }],
      },
      include: {
        chapter: { include: { book: true } },
        studySession: { select: { course: { select: { type: true, name: true, description: true, contentCollectionId: true, contentCollection: { select: { work: true } } } } } },
        players: { select: { userId: true } },
        invites: { include: { user: { select: { handle: true } } } },
      },
    }),
    prisma.chapterGuessGame.findMany({
      where: { userId: user.id, status: "IN_PROGRESS" },
      orderBy: { createdAt: "desc" },
      include: { questions: { orderBy: { order: "asc" }, take: 1, select: { chapterId: true } } },
    }),
    prisma.gameContentScope.findMany({
      where: { gameKey: { in: ["scrabble", "gezinsavond", "chapter-guess"] } },
      select: { gameKey: true, contentCollectionId: true },
    }),
    getContentContext(user.id),
    // Alleen zolang het spel nog in de lobby staat en je nog niet bent
    // toegetreden: start of annuleert de host, dan vervalt de uitnodiging.
    prisma.liveGameInvite.findMany({
      where: {
        userId: user.id,
        // Bij Samen studeren kun je ook later nog instappen, dus daar blijft
        // de uitnodiging staan zolang de sessie loopt.
        game: {
          OR: [{ status: "LOBBY" }, { mode: "STUDY", status: "IN_PROGRESS" }],
          players: { none: { userId: user.id } },
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        game: {
          select: {
            id: true,
            code: true,
            mode: true,
            host: { select: { id: true, handle: true } },
            chapter: { select: { number: true, book: { select: { name: true, contentCollectionId: true } } } },
            studySession: { select: { course: { select: { type: true, name: true, description: true, contentCollectionId: true, contentCollection: { select: { work: true } } } } } },
          },
        },
      },
    }),
  ]);

  const soloChapterIds = soloChapterGuessGames
    .map((game) => game.questions[0]?.chapterId)
    .filter((id): id is string => Boolean(id));

  const soloChapterCollections = soloChapterIds.length
    ? await prisma.chapter.findMany({
        where: { id: { in: soloChapterIds } },
        select: { id: true, book: { select: { contentCollectionId: true } } },
      })
    : [];

  const soloChapterCollectionById = new Map(
    soloChapterCollections.map((chapter) => [chapter.id, chapter.book.contentCollectionId])
  );

  const singleScope = (gameKey: string): string | undefined => {
    const matches = gameScopes.filter((scope) => scope.gameKey === gameKey);
    return matches.length === 1 ? matches[0].contentCollectionId : undefined;
  };

  const invitesReceived: ActivityItem[] = [];
  const invitesSent: ActivityItem[] = [];
  const activeGames: ActivityItem[] = [];

  for (const c of challenges) {
    const isSender = c.senderId === user.id;
    const opponent = isSender ? c.receiver : c.sender;
    const label = `${c.chapter.book.name} ${c.chapter.number}`;
    if (c.status === "PENDING") {
      (isSender ? invitesSent : invitesReceived).push({
        kind: "challenge",
        id: c.id,
        opponentName: opponent.handle,
        opponentId: opponent.id,
        label,
        link: "/challenges",
        myTurn: null,
        contentCollectionId: c.chapter.book.contentCollectionId,
        at: c.createdAt.toISOString(),
        playLink: isSender ? undefined : `/lesson/${c.chapterId}?challengeId=${c.id}`,
      });
    } else {
      const myCompletedAt = isSender ? c.senderCompletedAt : c.receiverCompletedAt;
      activeGames.push({
        kind: "challenge",
        id: c.id,
        opponentName: opponent.handle,
        opponentId: opponent.id,
        label,
        link: "/challenges",
        myTurn: myCompletedAt === null,
        contentCollectionId: c.chapter.book.contentCollectionId,
        at: c.createdAt.toISOString(),
        playLink: `/lesson/${c.chapterId}?challengeId=${c.id}`,
      });
    }
  }

  for (const g of scrabbleGames) {
    const isPlayer1 = g.player1Id === user.id;
    const opponent = isPlayer1 ? g.player2 : g.player1;
    const contentCollectionId = singleScope("scrabble");
    if (g.status === "PENDING") {
      (isPlayer1 ? invitesSent : invitesReceived).push({
        kind: "scrabble",
        id: g.id,
        opponentName: opponent.handle,
        opponentId: opponent.id,
        label: t("pages.wordGame"),
        link: "/scrabble",
        myTurn: null,
        contentCollectionId,
        at: g.updatedAt.toISOString(),
      });
    } else {
      activeGames.push({
        kind: "scrabble",
        id: g.id,
        opponentName: opponent.handle,
        opponentId: opponent.id,
        label: t("pages.wordGame"),
        link: `/scrabble/${g.id}`,
        myTurn: g.turnUserId === user.id,
        contentCollectionId,
        at: g.updatedAt.toISOString(),
      });
    }
  }

  for (const lg of liveGames) {
    const suffix = lg.status === "LOBBY" ? t("activeGames.lobbySuffix") : "";
    const contentCollectionId =
      lg.studySession?.course.contentCollectionId ??
      lg.chapter?.book.contentCollectionId ??
      (lg.mode === "FAMILY_GAME" ? singleScope("gezinsavond") : singleScope("chapter-guess"));
    const label =
      lg.mode === "STUDY" && lg.studySession
        ? `${studyLabel(lg.studySession.course)}${suffix}`
        : lg.mode === "CHAPTER_GUESS"
        ? `${t("activeGames.liveGame", { name: t("pages.chapterGuess") })}${suffix}`
        : lg.mode === "ALLESKENNER"
          ? `${t("pages.alleskenner")}${suffix}`
        : lg.mode === "QUICK_MISSIONARY"
          ? `${t("quickMissionary.together.inviteLabel")}${suffix}`
        : lg.mode === "FAMILY_GAME"
          ? `${t("pages.familyNight")}${suffix}`
          : `${t("activeGames.liveGame", { name: `${lg.chapter?.book.name} ${lg.chapter?.number}` })}${suffix}`;

    // Een lobby waar verder niemand op gereageerd/meegedaan heeft (net
    // aangemaakt, of uitgenodigd maar nog geen reactie) is geen "sessie die
    // je verder kan doen" — die staat de host toch al zelf op te kijken.
    // Pas zodra er een uitnodiging openstaat, tonen we 'm (als "wachten op
    // reactie", met een manier om 'm te beëindigen); zodra iemand echt is
    // toegetreden is het een volwaardige actieve sessie, ongeacht status.
    const joinedUserIds = new Set(lg.players.map((p) => p.userId));
    if (lg.status === "LOBBY" && joinedUserIds.size <= 1) {
      if (lg.hostId !== user.id) continue; // kan niet voorkomen gezien de WHERE hierboven, maar voor de zekerheid
      for (const invite of lg.invites) {
        if (joinedUserIds.has(invite.userId)) continue;
        invitesSent.push({
          kind: "live",
          id: lg.id,
          opponentName: invite.user.handle,
          opponentId: invite.userId,
          label,
          link: `/live/${lg.code}`,
          myTurn: null,
          contentCollectionId,
          code: lg.code,
          at: lg.createdAt.toISOString(),
        });
      }
      continue;
    }

    activeGames.push({
      kind: "live",
      id: lg.id,
      opponentName: null,
      opponentId: null,
      label,
      link: `/live/${lg.code}`,
      myTurn: null,
      contentCollectionId,
      code: lg.code,
      at: lg.createdAt.toISOString(),
    });
  }

  const LEVEL_LABELS: Record<string, string> = {
    BEGINNER: t("chapterGuessLevels.beginner"),
    ADVANCED: t("chapterGuessLevels.advanced"),
    EXPERT: t("chapterGuessLevels.expert"),
  };
  for (const g of soloChapterGuessGames) {
    activeGames.push({
      kind: "chapter-guess-solo",
      id: g.id,
      opponentName: null,
      opponentId: null,
      label: t("activeGames.soloChapterGuess", {
        name: t("pages.chapterGuess"),
        level: LEVEL_LABELS[g.level],
        n: g.currentIndex + 1,
        total: g.questionCount,
      }),
      link: `/chapter-guess/solo/${g.id}`,
      myTurn: null,
      contentCollectionId: g.questions[0]?.chapterId
        ? soloChapterCollectionById.get(g.questions[0].chapterId)
        : undefined,
      at: g.createdAt.toISOString(),
    });
  }

  const liveInvitesReceived: ActivityItem[] = receivedLiveInvites.map(({ game, createdAt }) => ({
    kind: "live",
    id: game.id,
    opponentName: game.host.handle,
    opponentId: game.host.id,
    label:
      game.mode === "STUDY" && game.studySession
        ? studyLabel(game.studySession.course)
        : game.mode === "CHAPTER_GUESS"
        ? t("pages.chapterGuess")
        : game.mode === "ALLESKENNER"
          ? t("pages.alleskenner")
        : game.mode === "QUICK_MISSIONARY"
          ? t("quickMissionary.together.inviteLabel")
        : game.mode === "FAMILY_GAME"
          ? t("pages.familyNight")
          : `${game.chapter?.book.name} ${game.chapter?.number}`,
    link: `/live/${game.code}`,
    myTurn: null,
    contentCollectionId:
      game.studySession?.course.contentCollectionId ??
      game.chapter?.book.contentCollectionId ??
      (game.mode === "FAMILY_GAME" ? singleScope("gezinsavond") : singleScope("chapter-guess")),
    code: game.code,
    at: createdAt.toISOString(),
  }));

  return {
    liveInvitesReceived,
    invitesReceived,
    invitesSent,
    activeGames,
    activeContentCollectionId: contentContext.active.id,
  };
}
