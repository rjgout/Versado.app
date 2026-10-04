"use client";

import { nanoid } from "nanoid";
import { StreakContinuationCard } from "@/components/StreakContinuation";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ExerciseCard, LessonResultMascot, type Exercise } from "@/components/LessonFlow";
import PersonCard from "@/components/PersonCard";
import ChapterPopup from "@/components/ChapterPopup";
import { ACHIEVEMENT_DISPLAY } from "@/lib/achievementDisplay";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { useT } from "@/components/I18nProvider";
import { translateOr } from "@/lib/i18n/core";

// Server-opgeloste content-blokken (zie /intro/[lessonId]/page.tsx) — de
// ruwe vorm staat in prisma/introContent.ts (IntroBlock); personen/boeken
// zijn hier al naar {slug, name} omgezet zodat deze component zelf niets
// extra's hoeft op te vragen (behalve PersonCard's eigen, losse
// detail-fetch bij het openklappen).
export type ResolvedIntroBlock =
  | { type: "text"; body: string }
  | { type: "poll"; question: string; options: string[] }
  | { type: "reflection"; question: string; prompts?: string[] }
  | { type: "steps"; title?: string; steps: { label: string; description?: string }[] }
  | { type: "personTree"; intro?: string; persons: { slug: string; name: string }[] }
  | { type: "bookList"; intro?: string; books: { slug: string; name: string }[] }
  | {
      type: "scripture";
      label?: string;
      bookName: string;
      chapterNumber: number;
      verses: { number: number; text: string }[];
    }
  | {
      type: "readMore";
      label: string;
      href: string;
      // Aanwezig als de link naar een echt hoofdstuk gaat: dan opent dat in
      // een pop-up en blijf je in de les.
      chapter?: { id: string; title: string; linkLabel: string };
    }
  | { type: "finalChoices" };

interface Answer {
  exerciseId: string;
  given: string[];
}

interface Summary {
  correctCount: number;
  total: number;
  xpEarned: number;
  currentStreak: number;
  freezeCount: number;
  freezesEarned: number;
  freezeUsed: boolean;
  streakBroken: boolean;
  newAchievements: string[];
  alreadyStudiedToday: boolean;
  dayEarned?: boolean;
}

type Phase = "content" | "exercises" | "summary";

export default function IntroLessonFlow({
  lessonId,
  number,
  title,
  blocks,
  exercises,
  nextLessonId,
  courseHref,
}: {
  lessonId: string;
  number: number;
  title: string;
  blocks: ResolvedIntroBlock[];
  exercises: Exercise[];
  /** Volgende les in de reeks, indien die bestaat (server-side bepaald). */
  nextLessonId: string | null;
  /** Terug naar dé introductiecursus zelf, nooit de generieke /courses-lijst van alle cursustypes. */
  courseHref: string;
}) {
  const t = useT();
  // Een finalChoices-blok (alleen in de laatste les) hoort ná de eindtoets
  // te verschijnen, niet als content-blok ertussenin — het heeft zelf geen
  // "Verder"-knop, dus als het als gewoon content-blok in `blocks` zou staan
  // vóór de oefeningen, zou de flow daar vastlopen en de oefeningen nooit
  // bereiken. Daarom lichten we het er hier uit en tonen we het in de
  // eindsamenvatting, in plaats van de standaard "Verder →"-link.
  const hasFinalChoices = blocks.length > 0 && blocks[blocks.length - 1].type === "finalChoices";
  const contentBlocks = hasFinalChoices ? blocks.slice(0, -1) : blocks;

  const [phase, setPhase] = useState<Phase>("content");
  const [blockIndex, setBlockIndex] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activityId] = useState(() => nanoid());

  async function finish(all: Answer[]) {
    setSubmitting(true);
    const res = await fetch(`/api/intro-lessons/${lessonId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-activity-id": activityId },
      body: JSON.stringify({ answers: all }),
    });
    const data = await res.json();
    setSubmitting(false);
    setSummary(data);
    announceXpChanged();
    setPhase("summary");
  }

  function onExerciseDone(given: string[]) {
    const current = exercises[exerciseIndex];
    const next = [...answers, { exerciseId: current.id, given }];
    setAnswers(next);
    if (exerciseIndex + 1 < exercises.length) {
      setExerciseIndex(exerciseIndex + 1);
    } else {
      finish(next);
    }
  }

  function nextBlock() {
    if (blockIndex + 1 < contentBlocks.length) {
      setBlockIndex(blockIndex + 1);
    } else if (exercises.length > 0) {
      setPhase("exercises");
    } else {
      finish([]);
    }
  }

  if (phase === "content") {
    const block = contentBlocks[blockIndex];
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <Header number={number} title={title} />
        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-brand-500 transition-all duration-300"
            style={{ width: `${Math.round(((blockIndex + 1) / Math.max(1, contentBlocks.length + exercises.length)) * 100)}%` }}
          />
        </div>
        <BlockView block={block} onNext={nextBlock} />
      </div>
    );
  }

  if (phase === "exercises") {
    const current = exercises[exerciseIndex];
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <Header number={number} title={title} />
        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-brand-500 transition-all duration-300"
            style={{
              width: `${Math.round(((contentBlocks.length + exerciseIndex + 1) / Math.max(1, contentBlocks.length + exercises.length)) * 100)}%`,
            }}
          />
        </div>
        <ExerciseCard
          key={current.id}
          exercise={current}
          onDone={onExerciseDone}
          disabled={submitting}
          checkEndpoint={`/api/intro-exercises/${current.id}/check`}
        />
      </div>
    );
  }

  if (phase === "summary" && summary) {
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-4 text-center animate-pop">
        <LessonResultMascot
          scorePercent={summary.total > 0 ? Math.round((summary.correctCount / summary.total) * 100) : 100}
          celebrate={summary.newAchievements.length > 0}
        />
        <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
          {t("readingLesson.score", { correct: summary.correctCount, total: summary.total })}
        </h2>
        <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">+{summary.xpEarned} XP</p>
        <StreakContinuationCard />
        {summary.freezeUsed && (
          <p className="text-sm bg-ice-50 dark:bg-slate-700 text-ice-600 dark:text-ice-400 rounded-xl px-3 py-2">
            {t("lesson.freezeUsed")}
          </p>
        )}
        {summary.freezesEarned > 0 && (
          <p className="text-sm bg-gold-50 dark:bg-slate-700 text-gold-600 dark:text-gold-400 rounded-xl px-3 py-2">
            {summary.freezesEarned > 1
              ? t("lesson.freezesEarnedMany", { n: summary.freezesEarned })
              : t("lesson.freezesEarnedOne", { n: summary.freezesEarned })}
          </p>
        )}

        {summary.newAchievements.length > 0 && (
          <div className="flex flex-col gap-2 w-full">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
              {summary.newAchievements.length > 1 ? t("lesson.newAchievementsMany") : t("lesson.newAchievementsOne")}
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              {summary.newAchievements.map((slug) => {
                const display = ACHIEVEMENT_DISPLAY[slug];
                if (!display) return null;
                return (
                  <div key={slug} className="flex flex-col items-center gap-1">
                    <span className="text-3xl">{display.icon}</span>
                    <span className="text-xs font-bold dark:text-slate-200">{translateOr(t, `achievements.${slug}.name`, display.name)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {hasFinalChoices ? (
          <div className="flex flex-col gap-3 w-full mt-1">
            <Link href="/lesson" className="card flex items-center gap-4 hover:shadow-md hover:-translate-y-0.5 transition">
              <span className="text-3xl">📖</span>
              <div className="text-left">
                <p className="font-extrabold dark:text-slate-100">{t("lessonFlows.startReading")}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t("lessonFlows.firstChapter")}</p>
              </div>
            </Link>
            <Link href="/practice" className="card flex items-center gap-4 hover:shadow-md hover:-translate-y-0.5 transition">
              <span className="text-3xl">🎮</span>
              <div className="text-left">
                <p className="font-extrabold dark:text-slate-100">{t("lessonFlows.practiceLearned")}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t("lessonFlows.quickRound")}</p>
              </div>
            </Link>
            <Link href="/courses" className="card flex items-center gap-4 hover:shadow-md hover:-translate-y-0.5 transition">
              <span className="text-3xl">🗺️</span>
              <div className="text-left">
                <p className="font-extrabold dark:text-slate-100">{t("lessonFlows.discoverStory")}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t("lessonFlows.courses")}</p>
              </div>
            </Link>
          </div>
        ) : (
          <div className="flex gap-3 mt-1">
            <Link href={courseHref} className="btn-secondary">
              {t("lessonFlows.backToCourses")}
            </Link>
            {nextLessonId && (
              <Link href={`/intro/${nextLessonId}`} className="btn-primary">
                {t("lessonFlows.nextLesson")}
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function Header({ number, title }: { number: number; title: string }) {
  const t = useT();
  return (
    <div>
      <p className="text-xs font-bold uppercase text-brand-500 tracking-wide">{t("lessonFlows.lessonNumber", { n: number })}</p>
      <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{title}</h1>
    </div>
  );
}

function NextButton({ onNext, label }: { onNext: () => void; label?: string }) {
  const t = useT();
  return (
    <button className="btn-primary self-start" onClick={onNext}>
      {label ?? t("lessonFlows.next")}
    </button>
  );
}

function BlockView({ block, onNext }: { block: ResolvedIntroBlock; onNext: () => void }) {
  const t = useT();
  const [pollChoice, setPollChoice] = useState<string | null>(null);
  const [reflected, setReflected] = useState(false);

  switch (block.type) {
    case "text":
      return (
        <div className="card flex flex-col gap-4 animate-pop">
          <p className="text-lg leading-relaxed dark:text-slate-100">{block.body}</p>
          <NextButton onNext={onNext} />
        </div>
      );

    case "poll":
      return (
        <div className="card flex flex-col gap-3 animate-pop">
          <p className="font-extrabold dark:text-slate-100">{block.question}</p>
          <div className="flex flex-col gap-2">
            {block.options.map((opt) => (
              <button
                key={opt}
                onClick={() => setPollChoice(opt)}
                className={`text-left rounded-2xl border-2 px-4 py-3 transition ${
                  pollChoice === opt
                    ? "bg-brand-500 text-white border-brand-500"
                    : "border-slate-200 dark:border-slate-600 hover:border-brand-300 dark:text-slate-100"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          {pollChoice && <NextButton onNext={onNext} />}
        </div>
      );

    case "reflection":
      return (
        <div className="card flex flex-col gap-3 animate-pop">
          <p className="font-extrabold dark:text-slate-100">🤔 {block.question}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("lessonFlows.noRightAnswer")}
          </p>
          {!reflected ? (
            <button className="btn-secondary self-start" onClick={() => setReflected(true)}>
              {t("lessonFlows.reflected")}
            </button>
          ) : (
            <NextButton onNext={onNext} />
          )}
        </div>
      );

    case "steps":
      return (
        <div className="card flex flex-col gap-4 animate-pop">
          {block.title && <p className="font-extrabold dark:text-slate-100">{block.title}</p>}
          <ol className="flex flex-col gap-3">
            {block.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-brand-500 text-white text-sm font-extrabold flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold dark:text-slate-100">{s.label}</p>
                  {s.description && <p className="text-sm text-slate-500 dark:text-slate-400">{s.description}</p>}
                </div>
              </li>
            ))}
          </ol>
          <NextButton onNext={onNext} />
        </div>
      );

    case "personTree":
      return (
        <div className="card flex flex-col gap-3 animate-pop">
          {block.intro && <p className="dark:text-slate-100">{block.intro}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {block.persons.map((p) => (
              <PersonCard key={p.slug} slug={p.slug} name={p.name} />
            ))}
          </div>
          <NextButton onNext={onNext} />
        </div>
      );

    case "bookList":
      return (
        <div className="card flex flex-col gap-3 animate-pop">
          {block.intro && <p className="dark:text-slate-100">{block.intro}</p>}
          <div className="flex flex-wrap gap-2">
            {block.books.map((b) => (
              <span
                key={b.slug}
                className="rounded-full border-2 border-slate-200 dark:border-slate-600 px-3 py-1 text-sm font-bold dark:text-slate-100"
              >
                {b.name}
              </span>
            ))}
          </div>
          <NextButton onNext={onNext} />
        </div>
      );

    case "scripture":
      return (
        <div className="card flex flex-col gap-3 animate-pop !border-l-4 !border-brand-400">
          <p className="text-xs font-bold uppercase text-brand-500 tracking-wide">
            {block.label ?? `${block.bookName} ${block.chapterNumber}`}
          </p>
          <div className="flex flex-col gap-2">
            {block.verses.map((v) => (
              <p key={v.number} className="dark:text-slate-100">
                <span className="text-xs text-slate-400 dark:text-slate-500 align-super mr-1">{v.number}</span>
                {v.text}
              </p>
            ))}
          </div>
          <NextButton onNext={onNext} />
        </div>
      );

    case "readMore":
      return <ReadMoreBlock block={block} onNext={onNext} />;

    default:
      return null;
  }
}

function ReadMoreBlock({
  block,
  onNext,
}: {
  block: Extract<ResolvedIntroBlock, { type: "readMore" }>;
  onNext: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const chapter = block.chapter;

  return (
    <div className="card flex flex-col gap-3 animate-pop items-start">
      {chapter ? (
        <button onClick={() => setOpen(true)} className="btn-secondary">
          {block.label}
        </button>
      ) : (
        <Link href={block.href} className="btn-secondary">
          {block.label}
        </Link>
      )}
      <NextButton onNext={onNext} label={t("lessonFlows.continueLesson")} />
      {chapter && open && (
        <ChapterPopup
          chapterId={chapter.id}
          title={chapter.title}
          href={block.href}
          linkLabel={chapter.linkLabel}
          onClose={close}
        />
      )}
    </div>
  );
}
