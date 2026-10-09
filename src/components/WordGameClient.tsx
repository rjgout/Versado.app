"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { announceXpChanged } from "@/lib/xpBroadcast";
import UserTag from "@/components/UserTag";
import UserAvatar from "@/components/UserAvatar";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";
import PersonalMascot from "@/components/versado/PersonalMascot";
import FocusLayout from "@/components/versado/FocusLayout";
import { futureTime } from "@/lib/timeFormat";
import { StreakContinuationCard } from "@/components/StreakContinuation";
import { useLiveQuery, useLiveTopic } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import RankMedal from "@/components/versado/RankMedal";

type LetterState = "correct" | "present" | "absent";

interface GuessView {
  word: string;
  result: LetterState[];
}

interface VerseMatch {
  bookName: string;
  chapterNumber: number;
  verseNumber: number;
  text: string;
}

interface LeaderboardEntry {
  rank: number;
  handle: string;
  discriminator: string;
  userId: string;
  finishedAt: string;
  minutesAfterRelease: number;
  solvedClock: string;
}

interface GameView {
  dayKey: string;
  nextReleaseAt: string;
  nextReleaseDay: "today" | "tomorrow";
  bonusSettlesAt: string;
  serverNow: number;
  wordLength: number;
  maxGuesses: number;
  guesses: GuessView[];
  status: "IN_PROGRESS" | "WON" | "LOST";
  xpEarned: number;
  leaderboardRank: number | null;
  leaderboardXpBonus: number;
  word: string | null;
  verses: VerseMatch[];
  leaderboard: LeaderboardEntry[];
  settled: boolean;
  provisionalRank: number | null;
  previousResult: { dayKey: string; rank: number; xp: number } | null;
  /** Toestelklok op het moment dat dit antwoord binnenkwam (voor het verschil met serverNow). */
  receivedAt: number;
}

type ServerGameView = Omit<GameView, "receivedAt">;

function stamp(view: GameView | ServerGameView): GameView {
  return { ...view, receivedAt: Date.now() };
}

const TILE_STYLES: Record<LetterState, string> = {
  // Groen voor "goede letter, goede plek" is de universeel herkende kleur
  // hiervoor; emerald (i.p.v. een generiek groen) omdat dat al elders in de
  // huisstijl gebruikt wordt (zie bv. ScrabbleBoardClient.tsx) en beter
  // combineert met het blauw/goud-palet dan een fel primair groen.
  correct: "bg-emerald-500 border-emerald-500 text-white",
  present: "bg-gold-500 border-gold-500 text-white",
  absent: "bg-slate-400 dark:bg-slate-600 border-slate-400 dark:border-slate-600 text-white",
};

// Het klassement is een eigen, lichte dataset: die kan live veranderen terwijl jij
// kijkt (iemand anders raadt het woord), het potje zelf alleen door jouw eigen gok.
interface RankingView {
  dayKey: string;
  leaderboard: LeaderboardEntry[];
  settled: boolean;
  provisionalRank: number | null;
}

export default function WordGameClient() {
  const t = useT();
  const uiLanguage = useUiLanguage();
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [guess, setGuess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const gameQuery = useLiveQuery<GameView>(["wordGame", "today"], async () => stamp(await fetchJson<GameView>("/api/word-game")), {
    scopes: ["wordGame"],
    staleTime: 60_000,
    // Om 18:00 (eigen tijdzone) komt een nieuw woord; de server zegt wanneer (nextReleaseAt).
    // De client telt alleen de verstreken tijd sinds serverNow, dus een verzette toestelklok
    // vervroegt niets. Dit vervangt de eigen timer en zichtbaarheidscontrole van vroeger.
    validUntil: (view, fetchedAt) => fetchedAt + (Date.parse(view.nextReleaseAt) - view.serverNow),
  });
  const baseGame = gameQuery.data;
  const rankingQuery = useLiveQuery<RankingView>(["wordGame", "ranking"], () => fetchJson<RankingView>("/api/word-game/ranking"), {
    scopes: ["wordGameRanking"],
    staleTime: 60_000,
    enabled: baseGame !== undefined,
  });
  // Live: iemand anders raadt het woord → de server meldt dat, en alleen dan halen we het klassement opnieuw op.
  useLiveTopic("word-game-ranking", baseGame !== undefined);

  const ranking = rankingQuery.data;
  const game = useMemo<GameView | null>(() => {
    if (!baseGame) return null;
    // Een klassement van een andere woorddag (net om 18:00 omgeslagen) hoort hier niet.
    return ranking && ranking.dayKey === baseGame.dayKey
      ? { ...baseGame, leaderboard: ranking.leaderboard, settled: ranking.settled, provisionalRank: ranking.provisionalRank }
      : baseGame;
  }, [baseGame, ranking]);

  const loadError = !baseGame && gameQuery.error
    ? gameQuery.error instanceof Error && !gameQuery.error.message.startsWith("HTTP ")
      ? gameQuery.error.message
      : t("wordOfTheDay.loadFailed")
    : null;

  // Een nieuw woord (nieuwe woorddag): begin met een leeg invoerveld.
  const dayKey = baseGame?.dayKey;
  const [seenDayKey, setSeenDayKey] = useState(dayKey);
  if (dayKey !== seenDayKey) {
    setSeenDayKey(dayKey);
    setGuess("");
    setFormError(null);
  }

  // Het verschil tussen servertijd en toestelklok is vastgelegd op het moment van binnenkomen.
  const serverOffset = baseGame ? baseGame.serverNow - baseGame.receivedAt : 0;

  useEffect(() => {
    if (!game || game.settled || game.status !== "WON") return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [game]);

  async function submitGuess() {
    if (!game || submitting) return;
    if (guess.length !== game.wordLength) {
      setFormError(t("wordOfTheDay.wrongLength", { n: game.wordLength }));
      setShake(true);
      setTimeout(() => setShake(false), 350);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const data = await liveMutation(
        () =>
          fetchJson<GameView>("/api/word-game/guess", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guess }),
          }).then(stamp),
        {
          // Een gok raakt het potje (direct uit het antwoord), het klassement en wat op Vandaag staat.
          invalidates: ["wordGameRanking", "today"],
          onSuccess: (view) => {
            gameQuery.setData(view);
            rankingQuery.setData({
              dayKey: view.dayKey,
              leaderboard: view.leaderboard,
              settled: view.settled,
              provisionalRank: view.provisionalRank,
            });
          },
        }
      );
      setGuess("");
      if (data.status !== "IN_PROGRESS") announceXpChanged();
    } catch (error) {
      const message = error instanceof Error && !error.message.startsWith("HTTP ") ? error.message : null;
      setFormError(message ?? t("wordOfTheDay.somethingWrong"));
      setShake(true);
      setTimeout(() => setShake(false), 350);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <FocusLayout className="max-w-md items-center card text-center gap-3">
        <p className="text-red-600 dark:text-red-400 font-semibold">{loadError}</p>
        <Link href="/live" className="btn-secondary self-center">
          {t("wordOfTheDay.back")}
        </Link>
      </FocusLayout>
    );
  }

  if (!game) {
    return <FocusLayout className="items-center text-center text-slate-400 dark:text-slate-500">{t("common.loading")}</FocusLayout>;
  }

  const finished = game.status !== "IN_PROGRESS";
  const bonusWait = futureTime(game.bonusSettlesAt, uiLanguage, Math.max(clockNow, game.receivedAt) + serverOffset);
  const rows: GuessView[] = [...game.guesses];
  const emptyRows = game.maxGuesses - rows.length - (finished ? 0 : 1);

  return (
    <FocusLayout className="max-w-2xl gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">🔤 {t("pages.wordOfTheDay")}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {t("wordOfTheDay.intro", { length: game.wordLength, tries: game.maxGuesses })}
          </p>
        </div>
      </div>

      {game.previousResult && (
        <p className="rounded-xl bg-gold-50 px-3 py-2 text-sm font-bold text-gold-700 dark:bg-slate-800 dark:text-gold-400">
          {t("wordOfTheDay.yesterdayBonus", { rank: game.previousResult.rank, xp: game.previousResult.xp })}
        </p>
      )}

      

      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-5 gap-2">
            {row.word.split("").map((letter, j) => (
              <div
                key={j}
                className={`no-select aspect-square rounded-lg border-2 flex items-center justify-center text-xl font-extrabold uppercase animate-pop ${TILE_STYLES[row.result[j]]}`}
              >
                {letter}
              </div>
            ))}
          </div>
        ))}

        {!finished && (
          <div className={`grid grid-cols-5 gap-2 ${shake ? "animate-shake" : ""}`}>
            {Array.from({ length: game.wordLength }, (_, j) => (
              <div
                key={j}
                className="no-select aspect-square rounded-lg border-2 border-slate-300 dark:border-slate-600 flex items-center justify-center text-xl font-extrabold uppercase dark:text-slate-100"
              >
                {guess[j] ?? ""}
              </div>
            ))}
          </div>
        )}

        {Array.from({ length: Math.max(0, emptyRows) }, (_, i) => (
          <div key={`empty-${i}`} className="grid grid-cols-5 gap-2">
            {Array.from({ length: game.wordLength }, (_, j) => (
              <div
                key={j}
                className="aspect-square rounded-lg border-2 border-slate-200 dark:border-slate-700"
              />
            ))}
          </div>
        ))}
      </div>

      {!finished && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              className="input text-center uppercase tracking-widest font-extrabold"
              value={guess}
              maxLength={game.wordLength}
              disabled={submitting}
              onChange={(e) => setGuess(e.target.value.replace(/[^a-zA-Zà-ÿÀ-Ÿ]/g, "").toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitGuess();
              }}
              placeholder={t("wordOfTheDay.placeholder", { n: game.wordLength })}
              autoFocus
            />
            <button className="btn-primary" disabled={submitting} onClick={submitGuess}>
              {submitting ? "..." : t("wordOfTheDay.guess")}
            </button>
          </div>
          {formError && <p className="text-red-600 dark:text-red-400 text-sm font-semibold">{formError}</p>}
        </div>
      )}

      {finished && (
        <div className="card flex flex-col items-center gap-3 text-center animate-pop">
          <div className="aspect-square w-[clamp(110px,30vw,8.125rem)] shrink-0 sm:w-36 vs-decor">
            <PersonalMascot state={game.status === "WON" ? "success" : "encourage"} size={144} fill />
          </div>
          <p className="text-lg font-extrabold dark:text-slate-100">
            {game.status === "WON" ? t("wordOfTheDay.won") : t("wordOfTheDay.lost")}
          </p>
          {game.word && (
            <p className="text-slate-500 dark:text-slate-400">
              {rich(t("wordOfTheDay.theWordWas"), {
                word: <span className="font-extrabold uppercase text-brand-700 dark:text-brand-300">{game.word}</span>,
              })}
            </p>
          )}
          {game.xpEarned > 0 && (
            <div className="flex flex-col items-center gap-1">
              <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">+{game.xpEarned} XP</p>
              {/* De rangbonus komt pas als de woorddag overal voorbij is: tot
                  dan alleen de voorlopige plek. */}
              {game.settled && game.leaderboardRank && game.leaderboardXpBonus > 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t("wordOfTheDay.rankBonus", { rank: game.leaderboardRank, xp: game.leaderboardXpBonus })}
                </p>
              ) : !game.settled && game.provisionalRank && game.provisionalRank <= 10 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {bonusWait
                    ? t("wordOfTheDay.provisionalRank", { rank: game.provisionalRank, when: bonusWait })
                    : t("wordOfTheDay.provisionalRankSoon", { rank: game.provisionalRank })}
                </p>
              ) : null}
            </div>
          )}
          <StreakContinuationCard />
          <p className="text-sm text-slate-400 dark:text-slate-500">
            {t(game.nextReleaseDay === "today" ? "wordOfTheDay.comeBackToday" : "wordOfTheDay.comeBackTomorrow")}
          </p>
        </div>
      )}

      {finished && game.verses.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-extrabold dark:text-slate-100">
            {t("wordOfTheDay.whereItAppears", { word: game.word ?? "", count: game.verses.length })}
          </h2>
          <div className="flex flex-col gap-2">
            {game.verses.map((v, i) => (
              <details key={i} className="group card !py-2">
                <summary className="font-bold text-sm cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center justify-between dark:text-slate-100">
                  {v.bookName} {v.chapterNumber}:{v.verseNumber}
                  <span className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden>
                    ▾
                  </span>
                </summary>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{v.text}</p>
              </details>
            ))}
          </div>
        </div>
      )}

      <div className="card flex flex-col gap-3">
        <div>
          <h2 className="font-extrabold dark:text-slate-100">{t("wordOfTheDay.fastestTitle")}</h2>
          <p className="text-sm text-slate-400 dark:text-slate-500">
            {t("wordOfTheDay.fastestIntro")}
          </p>
          {!game.settled && game.leaderboard.length > 0 && (
            <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">{t("wordOfTheDay.provisionalNote")}</p>
          )}
        </div>

        {game.leaderboard.length > 0 ? (
          <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
            {game.leaderboard.map((entry) => (
              <div key={entry.rank} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                {entry.rank <= 3 ? (
                  <RankMedal
                    rank={entry.rank as 1 | 2 | 3}
                    label={entry.rank === 1 ? t("profile.medalGold") : entry.rank === 2 ? t("profile.medalSilver") : t("profile.medalBronze")}
                  />
                ) : <span className="w-7 text-center font-extrabold text-slate-500 dark:text-slate-400">{entry.rank}</span>}
                <UserAvatar id={entry.userId} handle={entry.handle} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate dark:text-slate-100">
                    <UserTag handle={entry.handle} discriminator={entry.discriminator} />
                  </p>
                </div>
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400 shrink-0">
                  {entry.solvedClock}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            {t("wordOfTheDay.nobodyYet")}
          </p>
        )}
      </div>
    </FocusLayout>
  );
}
