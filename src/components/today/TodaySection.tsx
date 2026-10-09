import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, Quote } from "lucide-react";
import { getT } from "@/lib/i18n";
import MediaArtwork from "@/components/versado/MediaArtwork";
import PersonalMascot from "@/components/versado/PersonalMascot";
import WordGameCountdown from "@/components/today/WordGameCountdown";
import SectionHeader from "@/components/today/SectionHeader";
import { interactiveCard, secondaryButton, surfaceCard } from "@/components/versado/styles";
import type { DailyGameState, TodayData } from "@/lib/today";
import { gameArtworkKeys } from "@/lib/artwork";
import type { MessageKey } from "@/lib/i18n/core";

// Dagelijkse content: de tekst van de dag, het woord van de dag en De
// Slimste Heilige van de dag. Rustig bij de tekst, iets meer energie bij de
// spellen. Plekken voor artwork en een mascotte staan al klaar.

function DailyGameCard({
  state,
  kind,
  artwork,
  title,
  statusKey,
  language,
  countdown,
}: {
  state: DailyGameState;
  kind: "game" | "quiz";
  artwork: string[];
  title: string;
  statusKey: MessageKey;
  language: string;
  /** Extra regel onder de status, bv. de aftelling naar het volgende woord. */
  countdown?: ReactNode;
}) {
  const t = getT(language);
  const done = state.status === "done";
  return (
    // Op tablet staan deze kaarten naast de tekst van de dag, onder elkaar:
    // dan krijgt het beeld een brede band bovenaan (klaar voor spelcovers).
    // Op telefoon en desktop een compacte rij met een vierkant beeld.
    <Link
      href={state.href}
      className={`${interactiveCard} flex items-center gap-4 overflow-hidden p-3 pr-4 md:flex-col md:items-stretch md:gap-0 md:p-0 lg:flex-row lg:items-center lg:gap-4 lg:p-3 lg:pr-4`}
    >
      <MediaArtwork
        kind={kind}
        artworkKey={artwork}
        ratio="1/1"
        sizes="(min-width: 1024px) 72px, (min-width: 768px) 300px, 72px"
        className="w-16 shrink-0 rounded-xl sm:w-[4.5rem] md:w-full md:aspect-[5/2] md:rounded-none lg:w-[4.5rem] lg:aspect-square lg:rounded-xl"
      />
      <div className="flex min-w-0 flex-1 items-center gap-4 md:p-4 lg:p-0">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-extrabold text-vs-fg">{title}</h3>
          <p className={`mt-0.5 flex items-center gap-1 text-sm ${done ? "font-semibold text-vs-success" : "text-vs-fg-3"}`}>
            {done && <Check className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden />}
            <span className="line-clamp-2">{t(statusKey)}</span>
          </p>
          {countdown && <p className="mt-0.5 text-sm font-semibold text-vs-fg-2">{countdown}</p>}
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />
      </div>
    </Link>
  );
}

export default function TodaySection({ data, language, dayComplete = false, serverNow }: { data: TodayData; language: string; dayComplete?: boolean; serverNow: number }) {
  const t = getT(language);
  const { dailyText, wordGame, dailyQuiz } = data;
  if (!dailyText && !wordGame && !dailyQuiz) return null;
  const wordStatus: MessageKey | null = wordGame
    ? wordGame.status === "todo"
      ? "today.wordGame.todo"
      : wordGame.status === "in-progress"
        ? "today.wordGame.inProgress"
        : wordGame.won
          ? "today.wordGame.won"
          : "today.wordGame.lost"
    : null;
  const quizStatus: MessageKey | null = dailyQuiz
    ? dailyQuiz.status === "todo"
      ? "today.dailyQuiz.todo"
      : dailyQuiz.status === "in-progress"
        ? "today.dailyQuiz.inProgress"
        : "today.dailyQuiz.done"
    : null;

  return (
    <section aria-labelledby="today-daily" className="vs-rise">
      <SectionHeader id="today-daily" title={t("today.dailyTitle")} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-cols-2">
        {dailyText && (
          <article className={`${surfaceCard} relative min-w-0 overflow-hidden sm:col-span-2 md:col-span-1 md:row-span-2 md:flex md:flex-col lg:col-span-2 lg:row-span-1 lg:block`}>
            <MediaArtwork kind="daily" artworkKey="daily:text" ratio="21/9" sizes="(min-width: 1024px) 640px, (min-width: 768px) 440px, 100vw" className="!aspect-auto h-24 sm:h-28">
              <span className="absolute left-4 top-4 rounded-full bg-vs-elevated/90 px-2.5 py-1 text-xs font-bold text-vs-fg-2 backdrop-blur">
                {t("dashboard.dailyText")}
              </span>
            </MediaArtwork>
            <div className="relative p-5 sm:p-6 md:flex md:flex-1 md:flex-col lg:block">
              <Quote className="absolute -top-5 right-5 h-10 w-10 rounded-full border border-vs-line bg-vs-surface p-2 text-vs-xp" aria-hidden />
              {/* Een vers kan lang zijn: op een telefoon vier tot vijf regels,
                  daarna een beletselteken; de hele tekst staat achter
                  "Lees verder". Op grotere schermen past er meer. */}
              <blockquote className="line-clamp-4 text-lg font-bold leading-relaxed text-vs-fg min-[400px]:line-clamp-5 sm:text-xl md:line-clamp-[7] lg:line-clamp-5">
                {dailyText.text}
              </blockquote>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 md:mt-auto md:pt-4 lg:mt-4 lg:pt-0">
                <p className="text-sm font-semibold text-vs-fg-3">
                  {dailyText.bookName} {dailyText.chapterNumber}:{dailyText.verseNumber}
                </p>
                <Link href={dailyText.href} className={secondaryButton}>
                  {t("dashboard.readMore")}
                </Link>
              </div>
            </div>
          </article>
        )}
        {wordGame && wordStatus && (
          <>
            <DailyGameCard state={wordGame} kind="game" artwork={gameArtworkKeys("word-game")} title={t("pages.wordOfTheDay")} statusKey={wordStatus} language={language}
              countdown={wordGame.status === "done" && wordGame.nextReleaseAt ? <WordGameCountdown serverNow={serverNow} nextReleaseAt={wordGame.nextReleaseAt} /> : undefined} />
          </>
        )}
        {dailyQuiz && quizStatus && (
          <DailyGameCard state={dailyQuiz} kind="quiz" artwork={gameArtworkKeys("alleskenner")} title={t("today.dailyQuiz.title", { name: t("pages.alleskenner") })} statusKey={quizStatus} language={language} />
        )}
      </div>
      {dayComplete && (
        <div className={`${surfaceCard} mt-3 flex items-center justify-between gap-4 p-4 sm:mt-4 sm:p-5`}>
          <p className="max-w-md text-sm font-semibold leading-relaxed text-vs-fg-2 sm:text-base">{t("today.dayComplete")}</p>
          <div className="aspect-square w-[clamp(96px,28vw,7.5rem)] shrink-0 sm:w-32 vs-decor">
            <PersonalMascot state="sleep" size={128} fill />
          </div>
        </div>
      )}
    </section>
  );
}
