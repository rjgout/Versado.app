import { prisma } from "@/lib/db";
import { addDays, weekStartKey, amsterdamNow, type AmsterdamTime } from "@/lib/dates";
import { tierForWeek, getLeagueSettings, TIER_ORDER } from "@/lib/leagues";
import { notifyDailyReminder, notifyDailyText, notifyWeeklyResult, notifySeasonResult, notifyWordGame, notifyWordGameRank } from "@/lib/notify";
import { getTextOfTheDay } from "@/lib/dailyText";
import { settleWordGameBonuses, wordGameDayKey } from "@/lib/wordGame";
import { broadcastPresenceUpdate } from "@/lib/presence";
import { getIO } from "@/server/gameServer";
import { runFsyWeeklyCheckIfDue } from "@/lib/fsyContent";
import { dayKeyInZone, hhmmInZone, resolveTimeZone } from "@/lib/timeZone";
import { streakDayGap } from "@/lib/learning/streakRules";
import { refreshDueFriendStreaks, refreshFriendStreaksFor } from "@/lib/social/friendStreaks";
import { refreshDueGroups, refreshGroupsFor } from "@/lib/social/groupStreak";
import { cleanupRegistrations } from "@/lib/registration";
import { runGroupAdminMaintenance } from "@/lib/social/groups";
import { getStreakContinuation } from "@/lib/streakContinuation";
import { runStreakReturnReminders } from "@/lib/streakReturnNotifications";
import { runActivityReactionNotificationTick } from "@/lib/activityReactionNotifications";
import { syncPodcastFeed } from "@/lib/podcastFeed";
import { notifyPodcastEpisode } from "@/lib/notify";

const TICK_MS = 60_000;
export const PODCAST_FEED_SYNC_INTERVAL_MS = 60 * 60_000;
// Vast (niet instelbaar) moment voor de wekelijkse uitslag — dit is geen
// per-gebruiker voorkeur zoals de dagelijkse herinnering, maar één
// systeemmoment vlak na het einde van de vorige week.
const WEEKLY_RESULT_TIME = "00:05";

// Vaste systeemmomenten (de weekuitslag) toetsen tegen de
// Nederlandse wandklok, niet tegen de tijdzone van de servermachine (die in
// productie gewoon UTC kan zijn).
function amsterdamHHMM(amsterdam: AmsterdamTime): string {
  return `${String(amsterdam.hour).padStart(2, "0")}:${String(amsterdam.minute).padStart(2, "0")}`;
}

/** Dag van de week (0 = zondag, 1 = maandag, ...) van een Nederlandse kalenderdatum. */
function amsterdamDayOfWeek(amsterdam: AmsterdamTime): number {
  return new Date(Date.UTC(amsterdam.year, amsterdam.month - 1, amsterdam.day)).getUTCDay();
}

function previousWeekStart(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Stuurt de dagelijkse "je hebt nog niet geoefend"-herinnering naar iedereen
 * wiens gekozen tijdstip (User.dailyReminderTime) samenvalt met de huidige
 * minuut, die vandaag nog niet heeft gestudeerd, en die minstens één kanaal
 * heeft aangezet. lastDailyReminderSentDate voorkomt dubbel versturen als de
 * tick door trage queries iets uitloopt.
 */
/**
 * De herinneringstijden (User.dailyReminderTime/dailyTextTime) zijn
 * kloktijden in de eigen tijdzone van de gebruiker. Per tijdzone die in
 * gebruik is: het huidige "HH:MM" en de kalenderdag daar. timeZone null =
 * nog onbekend, dan Nederlandse tijd (het oude gedrag).
 */
async function zoneGroups(now: Date): Promise<{ timeZone: string | null; time: string; today: string }[]> {
  const zones = await prisma.user.groupBy({ by: ["timeZone"] });
  return zones.map(({ timeZone }) => {
    const zone = resolveTimeZone(timeZone);
    return { timeZone, time: hhmmInZone(now, zone), today: dayKeyInZone(now, zone) };
  });
}

async function runDailyTextTick(): Promise<void> {
  const now = new Date();
  for (const group of await zoneGroups(now)) {
    const candidates = await prisma.user.findMany({
      where: {
        timeZone: group.timeZone,
        dailyTextTime: group.time,
        notifyDailyText: true,
        OR: [{ emailNotificationsEnabled: true }, { pushNotificationsEnabled: true }],
        AND: [{ OR: [{ lastDailyTextSentDate: null }, { lastDailyTextSentDate: { not: group.today } }] }],
      },
      select: { id: true, contentLanguage: true },
    });
    if (candidates.length === 0) continue;

    // Hetzelfde vers voor iedereen, maar in de contenttaal van elke ontvanger;
    // per taal maar één keer opzoeken.
    const textByLanguage = new Map<string, Awaited<ReturnType<typeof getTextOfTheDay>>>();
    for (const user of candidates) {
      if (!textByLanguage.has(user.contentLanguage)) {
        textByLanguage.set(user.contentLanguage, await getTextOfTheDay(now, user.contentLanguage));
      }
      const text = textByLanguage.get(user.contentLanguage);
      if (!text) continue;
      await notifyDailyText(user.id, { ...text, content: text.text }).catch(() => {});
      await prisma.user.update({ where: { id: user.id }, data: { lastDailyTextSentDate: group.today } }).catch(() => {});
    }
  }
}

async function runDailyReminderTick(): Promise<void> {
  const now = new Date();
  for (const group of await zoneGroups(now)) {
    const candidates = await prisma.user.findMany({
      where: {
        timeZone: group.timeZone,
        dailyReminderTime: group.time,
        streakInterruptedDay: null,
        OR: [{ emailNotificationsEnabled: true }, { pushNotificationsEnabled: true }],
        AND: [
          { OR: [{ lastDailyReminderSentDate: null }, { lastDailyReminderSentDate: { not: group.today } }] },
        ],
      },
      select: { id: true, lastStudyDate: true, lastStudyTimeZone: true, timeZone: true },
    });

    for (const user of candidates) {
      // Vandaag al gestudeerd (volgens dezelfde regel als de reeks)? Dan geen herinnering.
      const { gap } = streakDayGap(user, now);
      if (gap !== null && gap <= 0) continue;
      await notifyDailyReminder(user.id).catch(() => {});
      await prisma.user.update({ where: { id: user.id }, data: { lastDailyReminderSentDate: group.today } }).catch(() => {});
    }
  }
}

/**
 * Stuurt, één keer per week, de promotie/degradatie-uitslag van de zojuist
 * afgelopen week. Hergebruikt tierForWeek (dezelfde groep-rangschikking die
 * ook "lazy" de divisie van de nieuwe week bepaalt), puur lezend.
 */
async function runWeeklyResultTick(): Promise<void> {
  const now = new Date();
  const amsterdam = amsterdamNow(now);
  if (amsterdamDayOfWeek(amsterdam) !== 1 || amsterdamHHMM(amsterdam) !== WEEKLY_RESULT_TIME) return; // maandag, vast tijdstip (NL)

  const newWeek = weekStartKey(now);
  const endedWeek = previousWeekStart(newWeek);

  const endedScores = await prisma.weeklyScore.findMany({
    where: {
      weekStart: endedWeek,
      user: {
        OR: [{ emailNotificationsEnabled: true }, { pushNotificationsEnabled: true }],
        NOT: { lastWeeklyResultNotifiedWeek: endedWeek },
      },
    },
    select: { userId: true, tier: true },
  });

  for (const score of endedScores) {
    // Alleen rekenen, geen groepsplek claimen: dat gebeurt pas als de speler
    // deze week echt XP verdient (anders tellen groepen vol met wie niet meedoet).
    const newTier = await tierForWeek(prisma, score.userId, newWeek);
    const oldIdx = TIER_ORDER.indexOf(score.tier);
    const newIdx = TIER_ORDER.indexOf(newTier);
    const outcome = newIdx > oldIdx ? "promoted" : newIdx < oldIdx ? "demoted" : "stayed";

    await notifyWeeklyResult(score.userId, outcome, newTier).catch(() => {});
    await prisma.user
      .update({ where: { id: score.userId }, data: { lastWeeklyResultNotifiedWeek: endedWeek } })
      .catch(() => {});
  }
}

/**
 * Sluit een seizoen af zodra de huidige week op of na de eerste week ná het
 * seizoen valt, en start meteen het volgende. In tegenstelling tot de
 * wekelijkse plaatsing (die "lazy" per gebruiker gebeurt) kan dit niet lazy:
 * het seizoensresultaat heeft ALLE weken van het seizoen nodig om te
 * kloppen, dus dit is de ene plek in het hele systeem die wél als
 * eenmalige batchtaak draait — maar wel binnen de al bestaande
 * minuut-tick-scheduler, niet als losse cron-infrastructuur.
 */
export async function runSeasonRolloverTick(): Promise<void> {
  const activeSeason = await prisma.season.findFirst({ where: { status: "ACTIVE" } });
  if (!activeSeason) return; // kan niet gebeuren na de migratie, maar nooit crashen op een lege staat

  const currentWeek = weekStartKey();
  const firstWeekAfterSeason = addDays(activeSeason.startWeek, activeSeason.weekCount * 7);
  if (currentWeek < firstWeekAfterSeason) return; // seizoen loopt nog

  await prisma.$transaction(async (tx) => {
    // Her-check binnen de transactie: voorkomt dat twee gelijktijdige ticks
    // (bv. door een trage vorige run) hetzelfde seizoen dubbel afsluiten.
    const fresh = await tx.season.findUnique({ where: { id: activeSeason.id } });
    if (!fresh || fresh.status !== "ACTIVE") return;

    const scores = await tx.weeklyScore.findMany({
      where: { seasonId: activeSeason.id },
      orderBy: { weekStart: "asc" },
    });

    const byUser = new Map<string, typeof scores>();
    for (const s of scores) {
      const list = byUser.get(s.userId);
      if (list) list.push(s);
      else byUser.set(s.userId, [s]);
    }

    const groupWinnerCache = new Map<string, string | null>();
    async function winnerOfGroup(groupId: string): Promise<string | null> {
      if (!groupWinnerCache.has(groupId)) {
        const top = await tx.weeklyScore.findFirst({
          where: { groupId },
          orderBy: [{ xp: "desc" }, { id: "asc" }],
          select: { userId: true },
        });
        groupWinnerCache.set(groupId, top?.userId ?? null);
      }
      return groupWinnerCache.get(groupId) ?? null;
    }

    for (const [userId, userScores] of byUser) {
      let highestTierIdx = -1;
      let promotions = 0;
      let demotions = 0;
      let competitionsWon = 0;
      let prevTierIdx: number | null = null;

      for (const s of userScores) {
        const idx = TIER_ORDER.indexOf(s.tier);
        if (idx > highestTierIdx) highestTierIdx = idx;
        if (prevTierIdx !== null) {
          if (idx > prevTierIdx) promotions++;
          else if (idx < prevTierIdx) demotions++;
        }
        prevTierIdx = idx;

        if (s.groupId && (await winnerOfGroup(s.groupId)) === userId) competitionsWon++;
      }

      const last = userScores[userScores.length - 1];
      let finalGroupPosition: number | null = null;
      if (last.groupId) {
        const peers = await tx.weeklyScore.findMany({
          where: { groupId: last.groupId },
          orderBy: [{ xp: "desc" }, { id: "asc" }],
          select: { userId: true },
        });
        const idx = peers.findIndex((p) => p.userId === userId);
        finalGroupPosition = idx === -1 ? null : idx + 1;
      }

      await tx.seasonResult.create({
        data: {
          seasonId: activeSeason.id,
          userId,
          highestTier: TIER_ORDER[highestTierIdx] ?? "BRONZE",
          finalTier: last.tier,
          finalGroupPosition,
          promotions,
          demotions,
          activeWeeks: userScores.length,
          competitionsWon,
        },
      });

      await notifySeasonResult(userId, activeSeason.index, last.tier, finalGroupPosition).catch(() => {});
    }

    const settings = await getLeagueSettings(tx);
    await tx.season.update({ where: { id: activeSeason.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await tx.season.create({
      data: {
        index: activeSeason.index + 1,
        startWeek: currentWeek,
        weekCount: settings.seasonWeekCount,
        status: "ACTIVE",
      },
    });
  });
}

/**
 * Stuurt om 18:00 in de eigen tijdzone van de gebruiker (het moment waarop
 * zijn woord van de dag wisselt, zie wordGamePeriod in src/lib/wordGame.ts)
 * een melding naar iedereen die dat aan heeft staan. Per tijdzone die in
 * gebruik is; timeZone null = Nederlandse tijd. lastWordGameNotifiedDate
 * (de woorddag) voorkomt dubbel versturen.
 */
async function runWordGameNotificationTick(): Promise<void> {
  const now = new Date();
  for (const group of await zoneGroups(now)) {
    if (group.time !== "18:00") continue;
    const today = wordGameDayKey(now, resolveTimeZone(group.timeZone));
    const candidates = await prisma.user.findMany({
      where: {
        timeZone: group.timeZone,
        OR: [{ emailNotificationsEnabled: true }, { pushNotificationsEnabled: true }],
        notifyWordGame: true,
        AND: [{ OR: [{ lastWordGameNotifiedDate: null }, { lastWordGameNotifiedDate: { not: today } }] }],
      },
      select: { id: true },
    });

    for (const user of candidates) {
      await notifyWordGame(user.id).catch(() => {});
      await prisma.user.update({ where: { id: user.id }, data: { lastWordGameNotifiedDate: today } }).catch(() => {});
    }
  }
}

/**
 * Deelt de rangbonus van het woord van de dag uit zodra een woorddag overal
 * ter wereld voorbij is (zie settleWordGameBonuses), en meldt het de top 10.
 * Goedkoop: meestal is er niets af te handelen.
 */
async function runWordGameBonusTick(): Promise<void> {
  for (const bonus of await settleWordGameBonuses()) {
    if (bonus.xp > 0) await notifyWordGameRank(bonus.userId, bonus.rank, bonus.xp).catch(() => {});
  }
}

/**
 * Zet tijdelijke "onzichtbaar voor vrienden" (User.invisibleUntil) automatisch
 * weer uit zodra de gekozen periode voorbij is, en meldt dat direct aan
 * vrienden (anders zou iemand pas na een eigen actie weer online lijken).
 * Query is goedkoop (meestal 0 rijen), dus geen aparte self-gating nodig
 * zoals bij de dag-/weekgebonden ticks hierboven.
 */

/**
 * Verwerkt afgesloten streak-dagen zonder dat de gebruiker online hoeft te zijn.
 * Na middernacht is de vorige kalenderdag definitief gemist. Een beschikbare
 * freeze wordt eerst ingezet; zonder voldoende freezes blijft de reeks
 * als onderbroken bewaard. Activiteiten gebruiken dezelfde dagafsluiting.
 */
async function runStreakRolloverTick(): Promise<void> {
  const now = new Date();
  const latestToday = dayKeyInZone(now, "Pacific/Kiritimati");
  const cutoff = addDays(latestToday, -1);
  const candidates = await prisma.user.findMany({
    where: {
      currentStreak: { gt: 0 }, streakInterruptedDay: null,
      // Het nieuwste van echte studiedag en eenmalige uitrolanker is de
      // effectieve ankerdag. Beide moeten verstreken zijn; anders zou iedere
      // gemigreerde gebruiker met een oude studiedag elke minuut meekomen.
      OR: [
        { streakGraceDay: null, lastStudyDate: { lt: cutoff } },
        { lastStudyDate: null, streakGraceDay: { lt: cutoff } },
        { lastStudyDate: { lt: cutoff }, streakGraceDay: { lt: cutoff } },
      ],
    },
    select: { id: true },
  });
  for (const user of candidates) {
    await getStreakContinuation(user.id, now)
      .catch((e) => console.error(`Reeksafsluiting mislukt voor ${user.id}:`, e));
  }
}

async function runIncognitoExpiryTick(): Promise<void> {
  const expired = await prisma.user.findMany({
    where: { invisibleUntil: { lte: new Date() } },
    select: { id: true },
  });
  if (expired.length === 0) return;

  const io = getIO();
  for (const user of expired) {
    await prisma.user.update({ where: { id: user.id }, data: { invisibleUntil: null } }).catch(() => {});
    await broadcastPresenceUpdate(io, user.id).catch(() => {});
  }
}

// --- Samen: vriendenreeksen en groepsreeksen ------------------------------
//
// De persoonlijke reeks is de bron: nieuwe StreakDay-rijen (gestudeerd, of
// bevroren door de reeksafsluiting hierboven) worden hier opgepakt voor de
// vriendenreeksen en groepen van die mensen. Daarnaast worden dagen
// afgesloten die voor iedereen voorbij zijn. Alles is idempotent; een
// overlap in het tijdvenster kan dus geen kwaad.
//
// Schaal: elke stap zoekt via een index alleen wat nu relevant is (nieuwe
// StreakDay-rijen op createdAt, groepen en vriendenreeksen op nextCheckAt,
// beheerders apart). Er wordt nooit elke minuut over alle gebruikers,
// groepen of leden gelopen; zie docs/SAMEN.md.
let socialWatermark = new Date(Date.now() - 10 * 60_000);
let socialTickRunning = false;
let lastAdminMaintenance = 0;

async function runSocialTick(): Promise<void> {
  if (socialTickRunning) return;
  socialTickRunning = true;
  try {
    const now = new Date();
    const since = new Date(socialWatermark.getTime() - 5_000);
    socialWatermark = now;
    const fresh = await prisma.streakDay.findMany({ where: { createdAt: { gt: since } }, select: { userId: true, status: true } });
    const userIds = [...new Set(fresh.map((row) => row.userId))];
    const studiedUserIds = [...new Set(fresh.filter((row) => row.status === "STUDIED").map((row) => row.userId))];
    await refreshFriendStreaksFor(userIds, now);
    await refreshGroupsFor(userIds, now, studiedUserIds);
    await refreshDueGroups(now);
    await refreshDueFriendStreaks(now);
    if (now.getTime() - lastAdminMaintenance >= 60 * 60_000) {
      lastAdminMaintenance = now.getTime();
      await runGroupAdminMaintenance(now);
    }
  } finally {
    socialTickRunning = false;
  }
}

// Aanmeldingen en onbevestigde accounts opruimen (src/lib/registration.ts):
// eens per uur is ruim genoeg, het gaat om dagen en weken.
let lastRegistrationCleanup = 0;

async function runRegistrationCleanupTick(): Promise<void> {
  const now = Date.now();
  if (now - lastRegistrationCleanup < 60 * 60_000) return;
  lastRegistrationCleanup = now;
  const { pending, accounts } = await cleanupRegistrations(new Date(now));
  if (pending || accounts) console.log(`Opgeruimd: ${pending} aanmelding(en), ${accounts} onbevestigd(e) account(s).`);
}

/**
 * Klein, geheugenlokaal ritme voor de externe podcastfeeds. De scheduler
 * roept dit elke minuut aan, maar een poging telt meteen mee zodat een trage
 * of falende feed niet bij elke minuut opnieuw wordt belast. De vlag blijft
 * los van de tijdstempel: een volgende, verschuldigde poging mag na een fout
 * gewoon weer starten zodra de eerdere promise is afgerond.
 */
export function createPodcastFeedSyncTicker(sync: () => Promise<void>, intervalMs = PODCAST_FEED_SYNC_INTERVAL_MS) {
  let lastSyncAt: number | null = null;
  let running = false;

  return {
    async run(now = Date.now()): Promise<boolean> {
      if (running || (lastSyncAt !== null && now - lastSyncAt < intervalMs)) return false;
      running = true;
      lastSyncAt = now;
      try {
        await sync();
        return true;
      } finally {
        running = false;
      }
    },
  };
}

const podcastFeedTicker = createPodcastFeedSyncTicker(() =>
  syncPodcastFeed(prisma, console.log, {
    onEpisodeCreated: (podcast, episode) => notifyPodcastEpisode(podcast.id, podcast.name, episode),
  })
);

/** De eerste minuuttick na een serverstart synchroniseert meteen; daarna hooguit elk uur. */
export function runPodcastFeedSyncTick(): Promise<boolean> {
  return podcastFeedTicker.run();
}

let started = false;

/** Start de in-process schedulers — bewust geen losse cron-infrastructuur (zie ook src/lib/leagues.ts). Eenmalig aan te roepen vanuit server.ts. */
export function startNotificationSchedulers(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    runDailyTextTick().catch((e) => console.error("Tekst van de dag mislukt:", e));
    runDailyReminderTick().catch((e) => console.error("Dagelijkse herinnering mislukt:", e));
    runWeeklyResultTick().catch((e) => console.error("Wekelijkse uitslag mislukt:", e));
    runSeasonRolloverTick().catch((e) => console.error("Seizoensafsluiting mislukt:", e));
    runWordGameNotificationTick().catch((e) => console.error("Woord-van-de-dag-melding mislukt:", e));
    runWordGameBonusTick().catch((e) => console.error("Woord-van-de-dag-bonus mislukt:", e));
    runStreakRolloverTick()
      .then(() => runStreakReturnReminders())
      .catch((e) => console.error("Reeksafsluiting/herinnering mislukt:", e));
    runIncognitoExpiryTick().catch((e) => console.error("Incognito-vervaltijd mislukt:", e));
    runSocialTick().catch((e) => console.error("Samen (vrienden- en groepsreeksen) mislukt:", e));
    runRegistrationCleanupTick().catch((e) => console.error("Aanmeldingen opruimen mislukt:", e));
    runActivityReactionNotificationTick().catch((e) => console.error("Reactiemeldingen bundelen mislukt:", e));
    runFsyWeeklyCheckIfDue(prisma).catch((e) => console.error("FSY-weekcontrole mislukt:", e));
    runPodcastFeedSyncTick().catch((e) => console.error("Podcastfeed-synchronisatie mislukt:", e instanceof Error ? e.message : String(e)));
  }, TICK_MS);
}
