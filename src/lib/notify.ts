import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { getAppUrl } from "@/lib/baseUrl";
import { APP_NAME } from "@/lib/brand";
import { emitToUser } from "@/lib/realtime";
import type { NotificationKind } from "@/lib/notificationGroups";
import type { LeagueTier } from "@/generated/prisma/client";
import { getT } from "@/lib/i18n";
import { translateOr, type TFunction } from "@/lib/i18n/core";

// Elke gebeurtenis valt in één categorie, die de gebruiker in zijn profiel
// apart aan/uit kan zetten (zie User.notify* in schema.prisma) — bovenop,
// niet in plaats van, de kanaalschakelaars (email/pushNotificationsEnabled).
type NotifyCategory = "dailyReminder" | "dailyText" | "social" | "achievements" | "wordGame" | "streakReturn";

const CATEGORY_FIELD: Record<NotifyCategory, "notifyDailyReminder" | "notifyDailyText" | "notifySocial" | "notifyAchievements" | "notifyWordGame" | "notifyStreakReturn"> = {
  streakReturn: "notifyStreakReturn",
  dailyReminder: "notifyDailyReminder",
  dailyText: "notifyDailyText",
  social: "notifySocial",
  achievements: "notifyAchievements",
  wordGame: "notifyWordGame",
};

/** Wat de ontvanger te zien krijgt, in de taal van diens app (User.uiLanguage). */
interface NotifyContent {
  subject: string;
  /** Hoofdtekst van de e-mail (HTML); de knop en de voettekst komen uit emailWrap. */
  emailBody: string;
  emailText: string;
  ctaLabel: string;
  pushTitle: string;
  pushBody: string;
}

interface NotifyInput {
  interruptedDay?: string;
  userId: string;
  category: NotifyCategory;
  content: (t: TFunction) => NotifyContent;
  url: string;
  // Voor meldingen die alleen op dat moment zin hebben (bv. een live-
  // uitnodiging): geen e-mail, die komt pas binnen als het spel al voorbij is.
  pushOnly?: boolean;
  // Groep in het meldingencentrum; weglaten = niet in het meldingencentrum
  // (herinneringen zoals "je hebt vandaag nog niet geoefend": die zijn er
  // juist voor als je de app niet open hebt).
  kind?: NotificationKind;
}

const NOTIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Aantal meldingen in het meldingencentrum = het getal op het app-icoon. */
export async function notificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId } });
}

async function storeNotification(userId: string, kind: NotificationKind, title: string, body: string, url: string) {
  await prisma.$transaction([
    // Dezelfde melding nog eens (bv. twee keer "Bram heeft gespeeld — jij bent
    // aan de beurt!") vervangt de oude, in plaats van zich op te stapelen.
    prisma.notification.deleteMany({ where: { userId, kind, title, body } }),
    prisma.notification.deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - NOTIFICATION_MAX_AGE_MS) } } }),
    prisma.notification.create({ data: { userId, kind, title, body, url } }),
  ]);
}

/**
 * Meldingen met deze link weghalen, bv. een live-uitnodiging zodra het spel
 * begint of wordt geannuleerd: dan valt er niets meer te doen.
 */
export async function removeNotificationsByUrl(userIds: string[], url: string): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.notification.deleteMany({ where: { userId: { in: userIds }, url } });
  for (const userId of userIds) emitToUser(userId, "notifications_changed");
}

/**
 * Centrale dispatcher. Alleen voor categorieën die niet expliciet zijn
 * uitgezet (User.notify*, standaard allemaal aan):
 * - de melding komt in het meldingencentrum (als hij een `kind` heeft);
 * - push en e-mail alleen als de app nergens open staat (onlineSocketCount,
 *   bijgehouden door de socketserver): wie de app open heeft, ziet de bel,
 *   en krijgt dus niet dubbel een melding;
 * - en dan alleen via de kanalen die de gebruiker zelf heeft aangezet (zie
 *   User.emailNotificationsEnabled/pushNotificationsEnabled, beide standaard uit).
 * Faalt bewust stil per kanaal (bv. e-mail niet geconfigureerd, of geen
 * pushsubscripties) — een notificatie is nooit kritiek voor de aanroepende
 * flow (les afronden, vriendschapsverzoek versturen, ...).
 */
async function notifyUser(input: NotifyInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      email: true,
      uiLanguage: true,
      emailNotificationsEnabled: true,
      pushNotificationsEnabled: true,
      notifyDailyReminder: true,
      notifyDailyText: true,
      notifySocial: true,
      notifyAchievements: true,
      notifyWordGame: true,
      notifyStreakReturn: true,
      streakInterruptedDay: true,
      streakReturnSeenAt: true,
      onlineSocketCount: true,
    },
  });
  if (!user) return;
  if (!user[CATEGORY_FIELD[input.category]]) return;
  if (input.category === "streakReturn" && (user.streakInterruptedDay !== input.interruptedDay || user.streakReturnSeenAt || user.onlineSocketCount > 0)) return;
  const t = getT(user.uiLanguage);
  const content = input.content(t);
  const absoluteUrl = `${await getAppUrl()}${input.url}`;

  if (input.kind) {
    await storeNotification(input.userId, input.kind, content.pushTitle, content.pushBody, input.url).catch(() => {});
    // De socketserver deelt deze emitter met API-routes via globalThis; de
    // periodieke client-sync blijft de terugval wanneer realtime ontbreekt.
    emitToUser(input.userId, "notifications_changed");
  }
  if (user.onlineSocketCount > 0) return;

  const jobs: Promise<unknown>[] = [];
  if (user.emailNotificationsEnabled && !input.pushOnly) {
    jobs.push(
      sendMail({
        to: user.email,
        subject: content.subject,
        html: emailWrap(t, content.emailBody, absoluteUrl, content.ctaLabel),
        text: `${content.emailText} ${absoluteUrl}`,
      })
    );
  }
  if (user.pushNotificationsEnabled) {
    // Het getal op het app-icoon is het aantal meldingen in het
    // meldingencentrum: het verdwijnt pas als je ze afhandelt of wist.
    jobs.push(
      sendPushToUser(input.userId, {
        title: content.pushTitle,
        body: content.pushBody,
        url: input.url,
        badge: await notificationCount(input.userId),
      })
    );
  }
  await Promise.allSettled(jobs);
}

function emailWrap(t: TFunction, bodyHtml: string, ctaUrl: string, ctaLabel: string): string {
  return `<p>${bodyHtml}</p><p><a href="${ctaUrl}">${ctaLabel} →</a></p><p style="color:#94a3b8;font-size:12px">${t("notify.emailFooter", { app: APP_NAME })}</p>`;
}

/** Zelfde tekst voor e-mail en push; alleen de onderwerpregel/titel en de knop verschillen. */
function simple(subject: string, pushTitle: string, text: string, ctaLabel: string, emailBody = text): NotifyContent {
  return { subject, emailBody, emailText: text, ctaLabel, pushTitle, pushBody: text };
}

export async function notifyFreezeReceived(userId: string, senderDisplayName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "friends",
    url: "/friends",
    content: (t) => ({
      subject: t("notify.freezeTitle"),
      emailBody: t("notify.freezeText", { name: senderDisplayName }),
      emailText: `${t("notify.freezeText", { name: senderDisplayName })} ${t("notify.ctaFriends")}:`,
      ctaLabel: t("notify.ctaFriends"),
      pushTitle: t("notify.freezeTitle"),
      pushBody: t("notify.freezePush", { name: senderDisplayName }),
    }),
  });
}

/** `gameLabel` in de taal van de ontvanger, bv. t("pages.alleskenner") of een hoofdstuk. */
export async function notifyGameInvite(userId: string, hostName: string, gameLabel: (t: TFunction) => string, code: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "games",
    url: `/live/${code}`,
    pushOnly: true,
    content: (t) =>
      simple(t("notify.gameInviteTitle"), t("notify.gameInviteTitle"), t("notify.gameInviteText", { name: hostName, game: gameLabel(t) }), ""),
  });
}

export async function notifyFriendRequest(receiverUserId: string, senderDisplayName: string): Promise<void> {
  await notifyUser({
    userId: receiverUserId,
    category: "social",
    kind: "friends",
    url: "/friends",
    content: (t) => ({
      subject: t("notify.friendRequestSubject", { name: senderDisplayName }),
      emailBody: t("notify.friendRequestEmail", { name: `<strong>${senderDisplayName}</strong>`, app: APP_NAME }),
      emailText: `${t("notify.friendRequestEmail", { name: senderDisplayName, app: APP_NAME })} ${t("notify.ctaRequestText")}:`,
      ctaLabel: t("notify.ctaRequest"),
      pushTitle: t("notify.friendRequestTitle"),
      pushBody: t("notify.friendRequestPush", { name: senderDisplayName }),
    }),
  });
}

export async function notifyInviteAccepted(
  inviterUserId: string,
  friendDisplayName: string,
  isNewAccount: boolean
): Promise<void> {
  await notifyUser({
    userId: inviterUserId,
    category: "social",
    kind: "friends",
    url: "/friends",
    content: (t) => {
      const text = t(isNewAccount ? "notify.inviteAcceptedNew" : "notify.inviteAccepted", { name: friendDisplayName });
      return simple(t("notify.inviteAcceptedSubject", { name: friendDisplayName }), t("notify.inviteAcceptedTitle"), text, t("notify.ctaFriends"));
    },
  });
}

export async function notifyActivityReaction(
  ownerUserId: string,
  reactorDisplayName: string,
  emoji: string
): Promise<void> {
  await notifyUser({
    userId: ownerUserId,
    category: "social",
    kind: "friends",
    url: "/activity",
    content: (t) =>
      simple(
        t("notify.activityReactionTitle"),
        t("notify.activityReactionTitle"),
        t("notify.activityReactionText", { name: reactorDisplayName, emoji }),
        t("notify.ctaActivity")
      ),
  });
}

export async function notifyStreakReturn(userId: string, interruptedDay: string, absentDays: number): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.streakInterruptedDay !== interruptedDay || user.streakReturnSeenAt) return;
  await notifyUser({
    userId, category: "streakReturn", url: "/streak", interruptedDay,
    content: (t) => {
      const title = t(absentDays < 30 ? "streakReturn.notifyEarlyTitle" : absentDays < 365 ? "streakReturn.notifyLaterTitle" : "streakReturn.notifyLongTitle");
      const body = t(absentDays < 30 ? "streakReturn.notifyEarlyBody" : absentDays < 365 ? "streakReturn.notifyLaterBody" : "streakReturn.notifyLongBody", { n: user.currentStreak });
      return simple(title, title, body, t("streakReturn.continue"));
    },
  });
}

export async function notifyAchievement(userId: string, slug: string, achievementName: string, achievementIcon: string): Promise<void> {
  await notifyUser({
    userId,
    category: "achievements",
    kind: "achievements",
    url: "/profile",
    content: (t) => {
      const name = translateOr(t, `achievements.${slug}.name`, achievementName);
      return {
        subject: t("notify.achievementSubject", { name }),
        emailBody: t("notify.achievementEmail", { icon: achievementIcon, name: `<strong>${name}</strong>` }),
        emailText: `${t("notify.achievementEmail", { icon: achievementIcon, name: `"${name}"` })} ${t("notify.ctaProfile")}:`,
        ctaLabel: t("notify.ctaProfile"),
        pushTitle: `${t("notify.achievementTitle")} ${achievementIcon}`,
        pushBody: t("notify.achievementPush", { name }),
      };
    },
  });
}

export async function notifyWeeklyResult(userId: string, outcome: "promoted" | "demoted" | "stayed", tier: LeagueTier): Promise<void> {
  await notifyUser({
    userId,
    category: "achievements",
    kind: "competition",
    url: "/competition",
    content: (t) => {
      const tierName = t(`tiers.${tier}`);
      const text =
        outcome === "promoted"
          ? t("notify.weeklyPromoted", { tier: tierName })
          : outcome === "demoted"
            ? t("notify.weeklyDemoted", { tier: tierName })
            : t("notify.weeklyStayed", { tier: tierName });
      const title =
        outcome === "promoted" ? t("notify.weeklyPromotedTitle") : outcome === "demoted" ? t("notify.weeklyDemotedTitle") : t("notify.weeklyTitle");
      return { ...simple(t("notify.weeklySubject"), title, text, t("notify.ctaCompetition")), emailText: `${text} ${t("notify.ctaCompetition")}:` };
    },
  });
}

/** Melding bij het afsluiten van een seizoen (zie runSeasonRolloverTick in src/lib/scheduler.ts). */
export async function notifySeasonResult(
  userId: string,
  seasonIndex: number,
  tier: LeagueTier,
  finalPosition: number | null
): Promise<void> {
  await notifyUser({
    userId,
    category: "achievements",
    kind: "competition",
    url: "/profile",
    content: (t) => {
      const positionText = finalPosition ? ` (#${finalPosition})` : "";
      const text = t("notify.seasonText", { n: seasonIndex, tier: t(`tiers.${tier}`), position: positionText });
      return {
        ...simple(t("notify.seasonSubject", { n: seasonIndex }), t("notify.seasonTitle", { n: seasonIndex }), text, t("notify.ctaProfile")),
        emailText: `${text} ${t("notify.ctaProfile")}:`,
      };
    },
  });
}

export async function notifyDailyText(userId: string, text: { href: string; bookName: string; chapterNumber: number; verseNumber: number; content: string }): Promise<void> {
  // Rechtstreeks naar het vers, net als een klik op de tekst van de dag op het dashboard.
  const reference = `${text.bookName} ${text.chapterNumber}:${text.verseNumber}`;
  await notifyUser({
    userId,
    category: "dailyText",
    url: text.href,
    content: (t) => ({
      subject: t("notify.dailyTextSubject"),
      emailBody: `📖 <strong>${reference}</strong><br />${text.content}`,
      emailText: `📖 ${reference} — ${text.content} —`,
      ctaLabel: t("notify.ctaReadMore"),
      pushTitle: t("notify.dailyTextTitle"),
      pushBody: `${reference} — ${text.content}`,
    }),
  });
}

export async function notifyDailyReminder(userId: string): Promise<void> {
  await notifyUser({
    userId,
    category: "dailyReminder",
    url: "/dashboard",
    content: (t) => ({
      subject: t("notify.reminderSubject"),
      emailBody: t("notify.reminderEmail", { app: APP_NAME }),
      emailText: `${t("notify.reminderEmail", { app: APP_NAME })} ${t("notify.ctaPractice")}:`,
      ctaLabel: t("notify.ctaPractice"),
      pushTitle: t("notify.reminderTitle"),
      pushBody: t("notify.reminderPush"),
    }),
  });
}

export async function notifyChallengeReceived(receiverUserId: string, senderDisplayName: string, bookName: string, chapterNumber: number): Promise<void> {
  await notifyUser({
    userId: receiverUserId,
    category: "social",
    kind: "challenges",
    url: "/challenges",
    content: (t) => {
      const text = t("notify.challengeText", { name: senderDisplayName, chapter: `${bookName} ${chapterNumber}` });
      return { ...simple(text, t("notify.challengeTitle"), text, t("notify.ctaChallenge")), emailText: `${text} ${t("notify.ctaChallenge")}:` };
    },
  });
}

export async function notifyChallengeDeclined(senderUserId: string, receiverDisplayName: string): Promise<void> {
  await notifyUser({
    userId: senderUserId,
    category: "social",
    kind: "challenges",
    url: "/challenges",
    content: (t) =>
      simple(t("notify.challengeDeclinedSubject"), t("notify.challengeDeclinedTitle"), t("notify.challengeDeclinedText", { name: receiverDisplayName }), t("notify.ctaChallenges")),
  });
}

export async function notifyChallengeYourTurn(userId: string, opponentDisplayName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "challenges",
    url: "/challenges",
    content: (t) => {
      const text = t("notify.yourTurnText", { name: opponentDisplayName });
      return simple(text, t("notify.yourTurnChallengeTitle"), text, t("notify.ctaPlayTurn"));
    },
  });
}

export async function notifyScrabbleInvite(receiverUserId: string, senderDisplayName: string): Promise<void> {
  await notifyUser({
    userId: receiverUserId,
    category: "social",
    kind: "wordgame",
    url: "/scrabble",
    content: (t) => {
      const text = t("notify.scrabbleInviteText", { name: senderDisplayName });
      return simple(text, t("notify.scrabbleInviteTitle"), text, t("notify.ctaScrabble"));
    },
  });
}

export async function notifyScrabbleDeclined(senderUserId: string, receiverDisplayName: string): Promise<void> {
  await notifyUser({
    userId: senderUserId,
    category: "social",
    kind: "wordgame",
    url: "/scrabble",
    content: (t) =>
      simple(t("notify.scrabbleDeclinedSubject"), t("notify.challengeDeclinedTitle"), t("notify.scrabbleDeclinedText", { name: receiverDisplayName }), t("notify.ctaScrabbles")),
  });
}

export async function notifyScrabbleYourTurn(userId: string, opponentDisplayName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "wordgame",
    url: "/scrabble",
    content: (t) => {
      const text = t("notify.yourTurnText", { name: opponentDisplayName });
      return simple(text, t("notify.yourTurnScrabbleTitle"), text, t("notify.ctaPlayTurn"));
    },
  });
}

export async function notifyScrabbleFinished(userId: string, opponentDisplayName: string, won: boolean, tied: boolean): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "wordgame",
    url: "/scrabble",
    content: (t) => {
      const text = tied
        ? t("notify.tiedAgainst", { name: opponentDisplayName })
        : won
          ? t("notify.scrabbleWon", { name: opponentDisplayName })
          : t("notify.scrabbleLost", { name: opponentDisplayName });
      return simple(t("notify.scrabbleFinishedSubject", { text }), t("notify.scrabbleFinishedTitle"), text, t("notify.ctaResult"));
    },
  });
}

/** Zoekt de zojuist behaalde achievement-slugs (zie StudyResult.newAchievements) op en notificeert er per stuk over. */
export async function notifyNewAchievements(userId: string, slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  const achievements = await prisma.achievement.findMany({ where: { slug: { in: slugs } } });
  await Promise.allSettled(achievements.map((a) => notifyAchievement(userId, a.slug, a.name, a.icon)));
}

export async function notifyChallengeFinished(userId: string, opponentDisplayName: string, won: boolean, tied: boolean): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "challenges",
    url: "/challenges",
    content: (t) => {
      const text = tied
        ? t("notify.tiedAgainst", { name: opponentDisplayName })
        : won
          ? t("notify.challengeWon", { name: opponentDisplayName })
          : t("notify.challengeLost", { name: opponentDisplayName });
      return simple(t("notify.challengeFinishedSubject", { text }), t("notify.challengeFinishedTitle"), text, t("notify.ctaResult"));
    },
  });
}

/** De rangbonus van een afgesloten woorddag (zie settleWordGameBonuses in src/lib/wordGame.ts). */
export async function notifyWordGameRank(userId: string, rank: number, xp: number): Promise<void> {
  await notifyUser({
    userId,
    category: "achievements",
    kind: "wordgame",
    url: "/word-game",
    content: (t) => {
      const text = t("notify.wordGameRankText", { rank, xp });
      return { ...simple(t("notify.wordGameRankSubject"), t("notify.wordGameRankTitle", { rank }), text, t("notify.ctaGuessWord")), emailText: `${text} ${t("notify.ctaGuessWord")}:` };
    },
  });
}

export async function notifyWordGame(userId: string): Promise<void> {
  await notifyUser({
    userId,
    category: "wordGame",
    url: "/word-game",
    content: (t) => ({
      subject: t("notify.wordGameSubject"),
      emailBody: t("notify.wordGameEmail", { app: APP_NAME }),
      emailText: `${t("notify.wordGameEmail", { app: APP_NAME })} ${t("notify.ctaGuessWord")}:`,
      ctaLabel: t("notify.ctaGuessWord"),
      pushTitle: t("notify.wordGameTitle"),
      pushBody: t("notify.wordGamePush"),
    }),
  });
}

// --- Samen: vriendenreeksen, groepen en seintjes (src/lib/social/) ---------

export async function notifyFriendStreakInvite(userId: string, inviterName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "friends",
    url: "/friends",
    content: (t) => simple(t("together.notify.friendStreakInviteTitle"), t("together.notify.friendStreakInviteTitle"), t("together.notify.friendStreakInviteText", { name: inviterName }), t("notify.ctaFriends")),
  });
}

export async function notifyFriendStreakAccepted(userId: string, friendName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "friends",
    url: "/friends",
    content: (t) => simple(t("together.notify.friendStreakAcceptedTitle"), t("together.notify.friendStreakAcceptedTitle"), t("together.notify.friendStreakAcceptedText", { name: friendName }), t("notify.ctaFriends")),
  });
}

export async function notifyGroupInvite(userId: string, inviterName: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: "/groups",
    content: (t) => simple(t("together.notify.groupInviteTitle"), t("together.notify.groupInviteTitle"), t("together.notify.groupInviteText", { name: inviterName, group: groupName }), t("together.notify.ctaGroups")),
  });
}

/** Seintje van een vriend. `line` is de tweede regel uit de context (bv. de vriendenreeks), in de taal van de ontvanger. */
export async function notifyNudge(userId: string, senderName: string, url: string, line: (t: TFunction) => string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "friends",
    url,
    pushOnly: true,
    content: (t) => simple(t("together.notify.nudgeTitle", { name: senderName }), t("together.notify.nudgeTitle", { name: senderName }), line(t), t("together.notify.ctaOpen")),
  });
}

export async function notifyGroupFreezeNotNeeded(userId: string, groupId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: `/groups/${groupId}`,
    content: (t) => simple(t("together.notify.freezeNotNeededTitle"), t("together.notify.freezeNotNeededTitle"), t("together.notify.freezeNotNeededText", { group: groupName }), t("together.notify.ctaGroup")),
  });
}

export async function notifyGroupFreezeUsed(userId: string, groupId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: `/groups/${groupId}`,
    content: (t) => simple(t("together.notify.freezeUsedTitle"), t("together.notify.freezeUsedTitle"), t("together.notify.freezeUsedText", { group: groupName }), t("together.notify.ctaGroup")),
  });
}

/** Nieuw toegangsverzoek via de groepslink: alleen voor wie het mag afhandelen (zie joinRequestRecipients). */
export async function notifyGroupJoinRequest(userId: string, requesterName: string, groupId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: `/groups/${groupId}`,
    content: (t) => simple(t("together.notify.joinRequestTitle"), t("together.notify.joinRequestTitle"), t("together.notify.joinRequestText", { name: requesterName, group: groupName }), t("together.notify.ctaGroup")),
  });
}

export async function notifyGroupJoinApproved(userId: string, groupId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: `/groups/${groupId}`,
    content: (t) => simple(t("together.notify.joinApprovedTitle"), t("together.notify.joinApprovedTitle"), t("together.notify.joinApprovedText", { group: groupName }), t("together.notify.ctaGroup")),
  });
}

/** Bewust neutraal: geen reden, geen naam van wie weigerde. */
export async function notifyGroupJoinDeclined(userId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: "/groups",
    content: (t) => simple(t("together.notify.joinDeclinedTitle"), t("together.notify.joinDeclinedTitle"), t("together.notify.joinDeclinedText", { group: groupName }), t("together.notify.ctaGroups")),
  });
}

export async function notifyGroupAdminAssigned(userId: string, groupId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: `/groups/${groupId}`,
    content: (t) => simple(t("together.notify.groupAdminTitle"), t("together.notify.groupAdminTitle"), t("together.notify.groupAdminText", { group: groupName }), t("together.notify.ctaGroup")),
  });
}

export async function notifyGroupMemberPaused(userId: string, groupId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: `/groups/${groupId}`,
    content: (t) => simple(t("together.notify.groupMemberPausedTitle"), t("together.notify.groupMemberPausedTitle"), t("together.notify.groupMemberPausedText", { group: groupName }), t("together.notify.ctaGroup")),
  });
}

export async function notifyGroupMemberPauseEnded(userId: string, groupId: string, groupName: string): Promise<void> {
  await notifyUser({
    userId,
    category: "social",
    kind: "groups",
    url: `/groups/${groupId}`,
    content: (t) => simple(t("together.notify.groupMemberPauseEndedTitle"), t("together.notify.groupMemberPauseEndedTitle"), t("together.notify.groupMemberPauseEndedText", { group: groupName }), t("together.notify.ctaGroup")),
  });
}

/**
 * Een gebeurtenis voor een hele groep (bv. "Thomas heeft de reeks gered!"):
 * alleen in het meldingencentrum, in één keer, zonder push of e-mail, zodat
 * een groep van honderden leden niemand bestookt. Alleen voor wie sociale
 * meldingen aan heeft.
 */
export async function notifyGroupMembersInApp(
  userIds: string[],
  url: string,
  content: (t: TFunction) => { title: string; body: string }
): Promise<void> {
  if (userIds.length === 0) return;
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, notifySocial: true }, select: { id: true, uiLanguage: true } });
  const rows = users.map((user) => {
    const text = content(getT(user.uiLanguage));
    return { userId: user.id, kind: "groups", title: text.title, body: text.body, url };
  });
  if (rows.length === 0) return;
  await prisma.notification.createMany({ data: rows });
  for (const user of users) emitToUser(user.id, "notifications_changed");
}
