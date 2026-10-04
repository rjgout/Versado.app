"use client";

import SystemIcon from "@/components/versado/SystemIcon";
import { StreakContinuationCard } from "@/components/StreakContinuation";

import { useEffect, useState } from "react";
import Link from "next/link";
import { announceXpChanged } from "@/lib/xpBroadcast";
import IntroAudioButton from "@/components/IntroAudioButton";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";

type Level = "BEGINNER" | "ADVANCED" | "EXPERT";

interface ChapterLabel {
  chapterId: string;
  bookId: string;
  bookName: string;
  number: number;
  label: string;
}

interface QuestionView {
  index: number;
  total: number;
  introText: string;
  introAudio?: { url: string; start: number; end: number } | null;
  options: ChapterLabel[] | null;
  hintUsed: boolean;
}

interface GameView {
  gameId: string;
  level: Level;
  questionCount: number;
  currentIndex: number;
  hintCredits: number;
  status: "IN_PROGRESS" | "FINISHED";
  question: QuestionView | null;
  summary: { correctCount: number; total: number } | null;
}

interface ChapterOption {
  id: string;
  bookId: string;
  bookName: string;
  number: number;
}

interface Summary {
  correctCount: number;
  total: number;
  xpEarned?: number;
  currentStreak?: number;
  newAchievements?: string[];
  alreadyStudiedToday?: boolean;
  dayEarned?: boolean;
}

interface AnswerResult {
  correct: boolean;
  correctChapter: ChapterLabel;
  finished: boolean;
  nextQuestion: QuestionView | null;
  hintCredits: number;
  summary: Summary | null;
}

interface HintResult {
  eliminatedChapterId?: string;
  bookId?: string;
  bookName?: string;
  hintCredits: number;
}

export default function ChapterGuessSoloClient({ gameId }: { gameId: string }) {
  const t = useT();
  const [game, setGame] = useState<GameView | null>(null);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finalSummary, setFinalSummary] = useState<Summary | null>(null);

  const [pickedBookId, setPickedBookId] = useState("");
  const [pickedNumber, setPickedNumber] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<AnswerResult | null>(null);
  const [chosenChapterId, setChosenChapterId] = useState<string | null>(null);
  const [hint, setHint] = useState<HintResult | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
  const [givingUp, setGivingUp] = useState(false);
  const [gaveUpSummary, setGaveUpSummary] = useState<{ correctCount: number; total: number } | null>(null);

  useEffect(() => {
    fetch(`/api/chapter-guess/${gameId}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? t("chapterGuess.notFound"));
        setGame(data);
        if (data.status === "FINISHED" && data.summary) setFinalSummary(data.summary);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("wordOfTheDay.somethingWrong")));
    fetch("/api/chapters")
      .then((r) => r.json())
      .then(setChapters);
  }, [gameId]);

  function resetInputs() {
    setPickedBookId("");
    setPickedNumber("");
    setHint(null);
    setChosenChapterId(null);
  }

  async function submitAnswer(chapterId: string) {
    if (submitting) return;
    setSubmitting(true);
    setChosenChapterId(chapterId);
    setError(null);
    const res = await fetch(`/api/chapter-guess/${gameId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? t("wordOfTheDay.somethingWrong"));
      return;
    }
    setFeedback(data);
    setGame((g) => (g ? { ...g, hintCredits: data.hintCredits } : g));
    if (data.finished) {
      setFinalSummary(data.summary);
      announceXpChanged();
    }
  }

  function nextQuestion() {
    if (!game || !feedback?.nextQuestion) return;
    setGame({ ...game, currentIndex: feedback.nextQuestion.index, question: feedback.nextQuestion });
    setFeedback(null);
    resetInputs();
  }

  async function useHint() {
    if (hintLoading || hint || !game) return;
    setHintLoading(true);
    setError(null);
    const res = await fetch(`/api/chapter-guess/${gameId}/hint`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setHintLoading(false);
    if (!res.ok) {
      setError(data.error ?? t("chapterGuess.noHint"));
      return;
    }
    setHint(data);
    setGame((g) => (g ? { ...g, hintCredits: data.hintCredits } : g));
    if (data.bookId) setPickedBookId(data.bookId);
  }

  async function giveUp() {
    if (givingUp) return;
    setGivingUp(true);
    setError(null);
    const res = await fetch(`/api/chapter-guess/${gameId}/forfeit`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setGivingUp(false);
    if (!res.ok) {
      setError(data.error ?? t("wordOfTheDay.somethingWrong"));
      return;
    }
    setConfirmingGiveUp(false);
    setGaveUpSummary(data);
  }

  if (error && !game) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-3">
        <p className="text-red-600 dark:text-red-400 font-semibold">{error}</p>
        <Link href="/chapter-guess" className="btn-secondary self-center">
          {t("wordOfTheDay.back")}
        </Link>
      </div>
    );
  }

  if (!game) {
    return <p className="text-center text-slate-400 dark:text-slate-500">{t("common.loading")}</p>;
  }

  if (gaveUpSummary) {
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-4 text-center animate-pop">
        <div className="text-5xl">🏳️</div>
        <h2 className="text-2xl font-extrabold text-slate-600 dark:text-slate-300">{t("chapterGuess.gaveUp")}</h2>
        <p className="text-slate-500 dark:text-slate-400">
          {t("chapterGuess.gaveUpScore", { correct: gaveUpSummary.correctCount, total: gaveUpSummary.total })}
        </p>
        <div className="flex gap-3 mt-2">
          <Link href="/chapter-guess" className="btn-primary">
            {t("chapterGuess.again")}
          </Link>
          <Link href="/live" className="btn-secondary">
            {t("wordOfTheDay.back")}
          </Link>
        </div>
      </div>
    );
  }

  if (finalSummary) {
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-4 text-center animate-pop">
        <div className="text-5xl">🔎</div>
        <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
          {t("readingLesson.score", { correct: finalSummary.correctCount, total: finalSummary.total })}
        </h2>
        {!!finalSummary.xpEarned && <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">+{finalSummary.xpEarned} XP</p>}
        <StreakContinuationCard />
        {finalSummary.dayEarned && (
          <p className="flex items-center gap-1 text-orange-500 font-extrabold text-lg"><SystemIcon kind="streak" className="h-5 w-5" fill="currentColor" aria-hidden />{finalSummary.currentStreak}</p>
        )}
        <div className="flex gap-3 mt-2">
          <Link href="/chapter-guess" className="btn-primary">
            {t("chapterGuess.again")}
          </Link>
          <Link href="/live" className="btn-secondary">
            {t("wordOfTheDay.back")}
          </Link>
        </div>
      </div>
    );
  }

  const question = game.question;
  if (!question) return <p className="text-center text-slate-400 dark:text-slate-500">{t("common.loading")}</p>;

  const chaptersForBook = chapters.filter((c) => c.bookId === pickedBookId).sort((a, b) => a.number - b.number);
  const uniqueBooks = [...new Map(chapters.map((c) => [c.bookId, c.bookName])).entries()];
  const answered = feedback !== null;

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between text-sm font-bold text-slate-400 dark:text-slate-500">
        <span>
          {t("chapterGuess.questionOf", { n: question.index + 1, total: question.total })}
        </span>
        <div className="flex items-center gap-2">
          {game.level !== "EXPERT" && (
            <button className="btn-secondary !px-3 !py-1.5 !text-xs" disabled={hintLoading || hint !== null || answered} onClick={useHint}>
              {t("chapterGuess.hintButton", { n: game.hintCredits })}
            </button>
          )}
          <button
            className="btn-secondary !px-3 !py-1.5 !text-xs !text-red-500 dark:!text-red-400"
            disabled={givingUp}
            onClick={() => setConfirmingGiveUp(true)}
          >
            🏳️ {t("challenges.forfeit")}
          </button>
        </div>
      </div>

      

      {confirmingGiveUp && (
        <div className="card !py-3 flex flex-col sm:flex-row items-center justify-between gap-3 !border-2 !border-red-200 dark:!border-red-900">
          <p className="text-sm font-bold text-red-600 dark:text-red-400">
            {t("chapterGuess.confirmGiveUp")}
          </p>
          <div className="flex gap-2 shrink-0">
            <button className="btn-secondary !px-3 !py-1.5 !text-xs" disabled={givingUp} onClick={() => setConfirmingGiveUp(false)}>
              {t("activeGames.cancel")}
            </button>
            <button className="btn-primary !bg-red-500 !px-3 !py-1.5 !text-xs" disabled={givingUp} onClick={giveUp}>
              {givingUp ? t("courses.busy") : t("chapterGuess.yesGiveUp")}
            </button>
          </div>
        </div>
      )}
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${(question.index / question.total) * 100}%` }} />
      </div>

      <div className="card flex flex-col gap-5">
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("chapterGuess.readHeading")}</p>
        <p className="text-xl leading-relaxed italic">&ldquo;{question.introText}&rdquo;</p>
        <IntroAudioButton audio={question.introAudio} />

        {hint?.bookName && !answered && (
          <p className="text-sm bg-gold-50 dark:bg-slate-700 text-gold-600 dark:text-gold-400 rounded-xl px-3 py-2 font-bold">
            {t("chapterGuess.hintBook", { book: hint.bookName })}
          </p>
        )}

        {question.options ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {question.options.map((opt) => {
              const eliminated = hint?.eliminatedChapterId === opt.chapterId;
              const isCorrectOption = answered && feedback?.correctChapter.chapterId === opt.chapterId;
              const isWrongPick = answered && chosenChapterId === opt.chapterId && !isCorrectOption;
              return (
                <button
                  key={opt.chapterId}
                  disabled={submitting || answered || eliminated}
                  onClick={() => submitAnswer(opt.chapterId)}
                  className={`btn text-left border-2 ${
                    isCorrectOption
                      ? "bg-brand-500 text-white border-brand-500"
                      : isWrongPick
                        ? "bg-red-100 text-red-600 border-red-400"
                        : eliminated
                          ? "opacity-30 line-through border-slate-200 dark:border-slate-700"
                          : "bg-white dark:bg-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <AppSelect
              className="input"
              value={pickedBookId}
              disabled={answered}
              onChange={(value) => {
                setPickedBookId(value);
                setPickedNumber("");
              }}
              ariaLabel={t("chapterGuess.chooseBook")}
              options={[{ value: "", label: t("chapterGuess.chooseBook") }, ...uniqueBooks.map(([id, name]) => ({ value: id, label: name }))]}
            />
            <AppSelect
              className="input"
              value={pickedNumber === "" ? "" : String(pickedNumber)}
              disabled={answered || !pickedBookId}
              onChange={(value) => setPickedNumber(value ? Number(value) : "")}
              ariaLabel={t("challenges.chooseChapter")}
              options={[{ value: "", label: t("challenges.chooseChapter") }, ...chaptersForBook.map((c) => ({ value: String(c.number), label: t("chapterGuess.chapterN", { n: c.number }) }))]}
            />
            {!answered && (
              <button
                className="btn-primary self-start"
                disabled={submitting || !pickedBookId || pickedNumber === ""}
                onClick={() => {
                  const match = chapters.find((c) => c.bookId === pickedBookId && c.number === pickedNumber);
                  if (match) submitAnswer(match.id);
                }}
              >
                {t("chapterGuess.confirmChoice")}
              </button>
            )}
          </div>
        )}

        {answered && feedback && (
          <p
            className={`rounded-xl px-3 py-2 font-bold text-sm ${
              feedback.correct
                ? "bg-brand-50 dark:bg-slate-700 text-brand-700 dark:text-brand-300"
                : "bg-red-50 dark:bg-slate-700 text-red-500 dark:text-red-400"
            }`}
          >
            {feedback.correct ? t("lesson.correct") : t("lesson.wrongAnswer", { answer: feedback.correctChapter.label })}
          </p>
        )}

        {answered && !feedback?.finished && (
          <button className="btn-primary self-end" onClick={nextQuestion}>
            {t("chapterGuess.nextQuestion")}
          </button>
        )}

        {error && <p className="text-red-600 dark:text-red-400 text-sm font-semibold">{error}</p>}
      </div>
    </div>
  );
}
