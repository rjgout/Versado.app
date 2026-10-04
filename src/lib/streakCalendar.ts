import { prisma } from "@/lib/db";
import { userDayKey } from "@/lib/timeZone";
import { settleStreakDays } from "@/lib/streakContinuation";
import { continuationView, type StreakContinuationView } from "@/lib/learning/streakReturnRules";

export type StreakDayState = "STUDIED" | "RETURNED" | "FROZEN" | "NONE" | "FUTURE";

export interface StreakDayView {
  dayKey: string;
  day: number; // 1-31
  weekday: number; // 0 = maandag ... 6 = zondag
  state: StreakDayState;
}

export interface StreakMonthView {
  /** De kalenderdag van vandaag in de tijdzone van de gebruiker. */
  today: string;
  year: number;
  month: number; // 1-12
  days: StreakDayView[];
  daysStudied: number; // FROZEN telt hier bewust niet in mee, zie schema
  freezesUsed: number;
}

export interface YearMonth {
  year: number;
  month: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** maandag = 0 ... zondag = 6 (i.p.v. JS's search zondag = 0). */
function mondayFirstWeekday(year: number, month: number, day: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export async function getStreakMonth(userId: string, year: number, month: number, todayKey: string): Promise<StreakMonthView> {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startKey = `${year}-${pad(month)}-01`;
  const endKey = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  const rows = await prisma.streakDay.findMany({
    where: { userId, dayKey: { gte: startKey, lte: endKey } },
    select: { dayKey: true, status: true },
  });
  const byDay = new Map(rows.map((r) => [r.dayKey, r.status]));

  const days: StreakDayView[] = [];
  let daysStudied = 0;
  let freezesUsed = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dk = `${year}-${pad(month)}-${pad(d)}`;
    const found = byDay.get(dk);
    let state: StreakDayState;
    if (found === "STUDIED" || found === "RETURNED") {
      state = found;
      daysStudied++;
    } else if (found === "FROZEN") {
      state = "FROZEN";
      freezesUsed++;
    } else if (dk > todayKey) {
      state = "FUTURE";
    } else {
      state = "NONE";
    }
    days.push({ dayKey: dk, day: d, weekday: mondayFirstWeekday(year, month, d), state });
  }

  return { today: todayKey, year, month, days, daysStudied, freezesUsed };
}

export interface StreakOverview {
  continuation: StreakContinuationView;
  currentStreak: number;
  longestStreak: number;
  freezeCount: number;
  firstMonth: YearMonth;
  month: StreakMonthView;
}

function monthIndex(value: YearMonth): number {
  return value.year * 12 + value.month - 1;
}

/** Een kalenderverzoek mag nooit vóór de maand waarin het account begon. */
export function clampToStreakStartMonth(requested: YearMonth, firstMonth: YearMonth): YearMonth {
  return monthIndex(requested) < monthIndex(firstMonth) ? firstMonth : requested;
}

export async function getStreakOverview(userId: string, year?: number, month?: number): Promise<StreakOverview> {
  const now = new Date();
  const { user } = await prisma.$transaction((tx) => settleStreakDays(tx, userId, now));

  // Standaard de maand van vandaag, in de tijdzone van de gebruiker.
  const today = userDayKey(user);
  const firstDay = userDayKey(user, user.createdAt);
  const firstMonth = { year: Number(firstDay.slice(0, 4)), month: Number(firstDay.slice(5, 7)) };
  const requested = clampToStreakStartMonth(
    { year: year ?? Number(today.slice(0, 4)), month: month ?? Number(today.slice(5, 7)) },
    firstMonth
  );

  return {
    continuation: continuationView(user, now),
    currentStreak: user.currentStreak,
    longestStreak: user.longestStreak,
    freezeCount: user.freezeCount,
    firstMonth,
    month: await getStreakMonth(userId, requested.year, requested.month, today),
  };
}
