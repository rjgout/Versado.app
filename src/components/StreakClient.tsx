"use client";

import { useState } from "react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import Link from "next/link";
import SystemIcon from "@/components/versado/SystemIcon";
import { StreakContinuationCard, useStreakContinuation } from "@/components/StreakContinuation";
import StreakDayIndicator from "@/components/versado/StreakDayIndicator";
import type { StreakOverview, StreakDayView } from "@/lib/streakCalendar";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";




function monthLabel(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

function isActive(day: StreakDayView | null): boolean {
  return !!day && (day.state === "STUDIED" || day.state === "FROZEN" || day.state === "RETURNED");
}

export default function StreakClient() {
  const t = useT();
  const continuation = useStreakContinuation();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [period, setPeriod] = useState<{ year?: number; month?: number }>({});

  // De reeks verandert door afgeronde activiteiten (scope streak). Een nieuwe kalenderdag
  // (continuation.day) is een andere key, dus de pagina is ook na middernacht actueel.
  const query = useLiveQuery<StreakOverview>(
    ["streak", "overview", period.year ?? null, period.month ?? null, continuation?.day ?? null],
    () => {
      const params = new URLSearchParams();
      if (period.year !== undefined) params.set("year", String(period.year));
      if (period.month !== undefined) params.set("month", String(period.month));
      const qs = params.toString();
      return fetchJson<StreakOverview>(`/api/streak${qs ? `?${qs}` : ""}`);
    },
    { scopes: ["streak"], keepPreviousData: true }
  );
  const overview = query.data ?? null;
  const error = !overview && query.error
    ? query.error instanceof Error && !query.error.message.startsWith("HTTP ")
      ? query.error.message
      : t("streakPage.loadFailed")
    : null;

  if (error) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-3">
        <p className="text-red-600 dark:text-red-400 font-semibold">{error}</p>
        <Link href="/dashboard" className="btn-secondary self-center">
          {t("wordOfTheDay.back")}
        </Link>
      </div>
    );
  }

  if (!overview) {
    return <p className="text-center text-slate-400 dark:text-slate-500">{t("common.loading")}</p>;
  }

  const { month } = overview;
  const currentYear = Number(month.today.slice(0, 4));
  const currentMonth = Number(month.today.slice(5, 7));
  const isCurrentMonth = month.year === currentYear && month.month === currentMonth;
  const isFirstMonth = month.year === overview.firstMonth.year && month.month === overview.firstMonth.month;

  function goToMonth(delta: number) {
    let y = month.year;
    let m = month.month + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setPeriod({ year: y, month: m });
  }

  // Kalendergrid: eerste week vullen met lege cellen tot aan de weekdag van
  // dag 1, zodat de kolommen (Ma..Zo) kloppen.
  const weeks: (StreakDayView | null)[][] = [];
  let week: (StreakDayView | null)[] = new Array(month.days[0]?.weekday ?? 0).fill(null);
  for (const d of month.days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  const today = month.today;
  // De provider krijgt een voltooide terugkeer direct via het reeks-event.
  // Gebruik die actuele waarde ook in de hero, terwijl de kalender-API op de
  // achtergrond opnieuw laadt, zodat 7/7 nooit kort naast de oude stand staat.
  const displayedCurrentStreak = continuation?.currentStreak ?? overview.currentStreak;
  const displayedLongestStreak = Math.max(overview.longestStreak, displayedCurrentStreak);
  const displayedStatus = continuation?.status ?? overview.continuation.status;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 sm:gap-5">
      <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("streakPage.title")}</h1>

      <div className="card bg-gradient-to-br from-orange-400 to-red-500 text-white !border-orange-300/40 dark:!border-orange-200/20 !shadow-md dark:!shadow-none flex flex-col items-center gap-1 !py-8">
        <SystemIcon kind="streak" className="h-10 w-10 text-orange-100" fill="currentColor" aria-hidden />
        <div className="text-5xl font-extrabold leading-none">{displayedCurrentStreak}</div>
        <div className="text-orange-50 font-bold text-sm mt-1">{t("streakReturn.totalDays")}</div>
        {displayedStatus === "INTERRUPTED" && <p className="mt-1 text-sm text-white">{t("streakReturn.interrupted")}</p>}
        {displayedLongestStreak > 0 && (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/15 px-3.5 py-1.5 text-xs font-bold text-white">
            {t("streakPage.longest", { n: displayedLongestStreak })}
          </span>
        )}
      </div>

      <StreakContinuationCard />
      <div className="card !py-3 !bg-ice-50 dark:!bg-slate-800 !border-ice-400/30 dark:!border-slate-700 flex items-center gap-3">
        <span className="text-2xl shrink-0" aria-hidden>
          <SystemIcon kind="freeze" className="h-7 w-7 text-ice-500" aria-hidden />
        </span>
        <p className="text-sm text-ice-700 dark:text-ice-400">
          {t("streakReturn.explainFreeze")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card !py-3 flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1 text-xl font-extrabold text-orange-500"><SystemIcon kind="streak" className="h-5 w-5" fill="currentColor" aria-hidden />{month.daysStudied}</div>
          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("streakPage.daysThisMonth")}</div>
        </div>
        <div className="card !py-3 flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1 text-xl font-extrabold text-ice-600 dark:text-ice-400"><SystemIcon kind="freeze" className="h-5 w-5" aria-hidden />{overview.freezeCount}</div>
          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("lesson.freezes")}</div>
        </div>
      </div>

      <div className="card flex flex-col gap-3 !p-4 sm:!p-5">
        <div className="flex items-center justify-between">
          <button
            className="btn-secondary !min-h-9 !px-3 !py-1 disabled:opacity-30"
            onClick={() => goToMonth(-1)}
            disabled={isFirstMonth}
            aria-label={t("streakPage.prevMonth")}
          >
            ‹
          </button>
          <div className="text-center">
            <h2 className="font-extrabold text-lg capitalize dark:text-slate-100">{monthLabel(month.year, month.month, intlLocale)}</h2>
            {month.freezesUsed > 0 && (
              <p className="flex items-center justify-center gap-1 text-xs text-slate-400 dark:text-slate-500"><SystemIcon kind="freeze" className="h-3.5 w-3.5" />{month.freezesUsed > 1 ? t("streakPage.freezesUsedMany", { n: month.freezesUsed }) : t("streakPage.freezesUsedOne", { n: month.freezesUsed })}</p>
            )}
          </div>
          <button
            className="btn-secondary !min-h-9 !px-3 !py-1 disabled:opacity-30"
            onClick={() => goToMonth(1)}
            disabled={isCurrentMonth}
            aria-label={t("streakPage.nextMonth")}
          >
            ›
          </button>
        </div>

        <div>
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] text-center text-xs font-bold text-slate-400 dark:text-slate-500 mb-2">
            {t("streakPage.weekdays").split(",").map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {weeks.map((w, i) => (
              <div key={i} className="flex h-10">
                {w.map((d, j) => {
                  if (!d) return <div key={j} className="min-w-0 flex-1" />;

                  const active = isActive(d);
                  const prevActive = j > 0 ? isActive(w[j - 1]) : false;
                  const nextActive = j < 6 ? isActive(w[j + 1]) : false;
                  const isToday = d.dayKey === today;
                  const label = `${d.dayKey}: ${t(d.state === "STUDIED" ? "streakReturn.studiedDay" : d.state === "RETURNED" ? "streakReturn.returnedDay" : d.state === "FROZEN" ? "streakReturn.frozenDay" : d.state === "FUTURE" ? "streakReturn.futureDay" : "streakReturn.missedDay")}`;

                  if (active) {
                    return (
                      <div key={j} className="min-w-0 flex-1 relative" aria-label={label} title={label}>
                        <div
                          className={`absolute inset-y-0.5 flex items-center justify-center bg-gradient-to-b from-orange-400 to-red-500 text-white font-extrabold text-sm ${
                            prevActive ? "left-0" : "left-1 rounded-l-full"
                          } ${nextActive ? "right-0" : "right-1 rounded-r-full"} ${
                            isToday ? "ring-2 ring-offset-1 ring-orange-300 dark:ring-offset-slate-800" : ""
                          }`}
                        >
                          <span aria-hidden className="flex items-center gap-0.5">
                            {(d.state === "STUDIED" || d.state === "FROZEN" || d.state === "RETURNED") && <StreakDayIndicator state={d.state} />}{d.day}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={j} className="min-w-0 flex-1 flex items-center justify-center" aria-label={label} title={label}>
                      <div
                        className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${
                          isToday
                            ? "border-2 border-orange-400 text-orange-500"
                            : d.state === "FUTURE"
                              ? "text-slate-500 dark:text-slate-400"
                              : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {d.day}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-vs-fg-2">
          {(["STUDIED", "FROZEN", "RETURNED"] as const).map((state) => <span key={state} className="inline-flex items-center gap-1">
            <StreakDayIndicator state={state} />{t(state === "STUDIED" ? "streakReturn.studiedDay" : state === "FROZEN" ? "streakReturn.frozenDay" : "streakReturn.returnedDay")}
          </span>)}
        </div>
      </div>
    </div>
  );
}
