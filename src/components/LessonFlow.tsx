"use client";

import type { ExerciseCheckpoint } from "@/lib/learning/exerciseCheckpoint";
import AnnotationActions from "@/components/annotations/AnnotationActions";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import type { AnnotationList, AnnotationView } from "@/lib/annotations/clientContract";
import SystemIcon from "@/components/versado/SystemIcon";
import AchievementIcon from "@/components/versado/AchievementIcon";
import { StreakContinuationCard } from "@/components/StreakContinuation";


import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ACHIEVEMENT_DISPLAY } from "@/lib/achievementDisplay";
import { useT } from "@/components/I18nProvider";
import { translateOr } from "@/lib/i18n/core";
import type { TFunction } from "@/lib/i18n/core";
import { normalizeAnswer } from "@/lib/exerciseGen";
import { useActivityStatus } from "@/lib/useActivity";
import { announceXpChanged } from "@/lib/xpBroadcast";
import ReadAloudPlayer, { type ReadAloudControl, type ReadAloudStatus } from "@/components/ReadAloudPlayer";
import { useReadAloudPlayer } from "@/lib/readAloudPlayerContext";
import { chapterTerm, type ChapterTerm } from "@/lib/chapterTerm";
import { ContentStatusLine, LongChapterNotice, type ReadState } from "@/components/learning/ContentStatus";
import PersonalMascot from "@/components/versado/PersonalMascot";
import FocusLayout from "@/components/versado/FocusLayout";
import ExerciseFeedbackSheet from "@/components/ExerciseFeedbackSheet";
import { Flag, CheckCircle2, XCircle, Bookmark, StickyNote, Highlighter } from "lucide-react";
import { exerciseProgress } from "@/lib/exerciseProgress";
import type { ExerciseFeedbackContext } from "@/lib/exerciseFeedback";

export type ExerciseType = "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE" | "MULTIPLE_CHOICE" | "SEQUENCE" | "IMAGE_CHOICE";

export interface Exercise {
  id: string;
  type: ExerciseType;
  verseRef: string;
  prompt: string;
  hint?: string;
  blanks: number;
  wordBank?: string[];
  options?: string[];
}

export interface ReaderVerseView {
  id: string;
  number: number;
  text: string;
  bookmarked: boolean;
  highlighted: boolean;
  note: string;
  audioStart?: number | null;
}

type VerseView = ReaderVerseView;

/** Voorgelezen audio van het hoofdstuk, zie ReadAloudSource.audio. */
export interface ChapterAudio {
  url: string;
  end: number | null;
}

interface Props {
  chapterId: string;
  bookName: string;
  chapterNumber: number;
  previousChapterId: string | null;
  nextChapterId: string | null;
  verses: VerseView[];
  audio?: ChapterAudio | null;
  /** "hoofdstuk" of "afdeling" (Leer en Verbonden), zie src/lib/chapterTerm.ts. */
  term?: ChapterTerm;
  exercises: Exercise[];
  /** De door de server uitgedeelde oefenset; null als dit hoofdstuk geen vragen heeft. */
  sessionId: string | null;
  /** Lees- en oefenvoortgang van deze inhoud, gedeeld over alle routes. */
  content: { read: ReadState; exercisesAnswered: number; exercisesTotal: number; exercisesComplete: boolean };
  /** De leesroute waaruit het hoofdstuk geopend is (bepaalt alleen de knoppen). */
  route: "FREE_CHOICE" | "FRONT_TO_BACK" | "READING_LESSONS" | null;
  readingMinutes: number;
  /** Bij een lang hoofdstuk: dit hoofdstuk in Stap voor stap. */
  stepsHref: string | null;
  // Gezet als deze les gespeeld wordt als iemands beurt in een uitdaging
  // (zie /challenges) — de score telt dan ook mee voor die uitdaging, zie
  // /api/chapters/[chapterId]/submit.
  challengeId?: string;
  /** De cursus waaruit de les geopend is; gaat mee naar het volgende hoofdstuk (terugbalk). */
  courseId?: string;
  /** Vers om naartoe te scrollen en even op te lichten (bv. vanaf de tekst van de dag). */
  focusVerse?: number;
  /** Taal van de uitgave, voor de voorleesstem. */
  language?: string;
  /** Stabiele inhoudsleutel voor vraagfeedback, los van de route. */
  contentKey?: string;
}

type Phase = "read" | "exercises" | "review" | "summary";

interface SubmittedAnswer {
  exerciseId: string;
  given: string[];
  correct: boolean;
}

export interface SummaryResult {
  correctCount: number;
  total: number;
  xpEarned: number;
  baseXp: number;
  bonusXp: number;
  repeatXp: number;
  content: { read: ReadState; exercisesAnswered: number; exercisesTotal: number };
  scorePercent: number;
  currentStreak: number;
  longestStreak: number;
  streakBroken: boolean;
  freezeUsed: boolean;
  freezesEarned: number;
  freezeCount: number;
  newAchievements: string[];
  alreadyStudiedToday: boolean;
  dayEarned?: boolean;
}

const FONT_SCALE_KEY = "bom-reader-font-scale";
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.5;

export default function LessonFlow({ chapterId, bookName, chapterNumber, previousChapterId, nextChapterId, verses, audio, term = chapterTerm(null), exercises, sessionId, content, route, readingMinutes, stepsHref, challengeId, courseId, focusVerse, language, contentKey }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("read");
  const [read, setRead] = useState<ReadState>(content.read);
  const [justMarkedRead, setJustMarkedRead] = useState(false);
  const [showLongNotice, setShowLongNotice] = useState(stepsHref !== null);
  const hasExercises = sessionId !== null && exercises.length > 0;
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  useActivityStatus("📖", `Leest ${bookName} ${chapterNumber}`);

  // Registreer dat dit hoofdstuk gelezen wordt, los van of de quiz erna
  // wordt afgemaakt (nodig voor "ga verder waar je gebleven was" en om
  // lezen meetbaar te maken).
  useEffect(() => {
    fetch("/api/reading-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  // Lezen levert geen XP op; het uitdrukkelijk markeren als gelezen telt wel één keer als activiteit voor de reeks. Het hoofdstuk staat daarna wel
  // als gelezen in elke leesroute.
  async function markRead(): Promise<boolean> {
    const res = await fetch(`/api/chapters/${chapterId}/read`, { method: "POST" }).catch(() => null);
    if (!res?.ok) return false;
    setRead("READ");
    setJustMarkedRead(true);
    return true;
  }

  if (phase === "read") {
    const practiceLabel = t(content.exercisesComplete ? "progress.practiceAgain" : "progress.practice", { n: exercises.length });
    // Hoofdstuk voor hoofdstuk: na het lezen volgt de oefenset. Vrije keuze
    // (en een hoofdstuk buiten een route): lezen, oefenen mag daarna.
    const afterReading = route === "FRONT_TO_BACK";
    return (
      <FocusLayout className="max-w-2xl gap-4">
        {showLongNotice && stepsHref && <LongChapterNotice minutes={readingMinutes} stepsHref={stepsHref} onReadFull={() => setShowLongNotice(false)} />}
        {(read !== "UNREAD" || content.exercisesAnswered > 0) && (
          <ContentStatusLine read={read} exercisesAnswered={content.exercisesAnswered} exercisesTotal={content.exercisesTotal} />
        )}
        <ReaderView chapterId={chapterId} bookName={bookName} chapterNumber={chapterNumber} verses={verses} audio={audio} term={term} focusVerse={focusVerse} language={language} focus />
        <div className="flex flex-col gap-3">
          {justMarkedRead && <p className="text-sm text-vs-fg-2">{t("progress.readingNoXp")}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {previousChapterId && <Link href={`/lesson/${previousChapterId}${courseId ? `?cursus=${courseId}` : ""}`} className="btn-secondary">
              ← {t(`terms.${term.kind}.previous`)}
            </Link>}
            {read !== "READ" && afterReading && hasExercises && (
              <button className="btn-primary" onClick={async () => { if (await markRead()) setPhase("exercises"); }}>
                {t("progress.readAndPractice", { n: exercises.length })}
              </button>
            )}
            {read !== "READ" && !(afterReading && hasExercises) && (
              <button className="btn-primary" onClick={markRead}>
                {t("progress.markRead")}
              </button>
            )}
            {hasExercises && (read === "READ" || !afterReading) && (
              <button className={read === "READ" ? "btn-primary" : "btn-secondary"} onClick={() => setPhase("exercises")}>
                {practiceLabel}
              </button>
            )}
            {read === "READ" && !hasExercises && nextChapterId && (
              <Link href={`/lesson/${nextChapterId}${courseId ? `?cursus=${courseId}` : ""}`} className="btn-primary">
                {t(`terms.${term.kind}.next`)}
              </Link>
            )}
          </div>
        </div>
      </FocusLayout>
    );
  }

  if (phase === "exercises") return <ExerciseSessionQuestions
    exercises={exercises} review
    feedbackContext={exercise=>({source:'SCRIPTURE',questionId:exercise.id,courseId,contentKey,chapterId,verseRef:exercise.verseRef,contentLanguage:language})}
    submit={async answers=>{
      const res=await fetch(`/api/chapters/${chapterId}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,answers,challengeId,courseId})});
      const data=await res.json(); if(!res.ok)throw new Error(data.error??t('courses.error'));return data as SummaryResult;
    }} onComplete={result=>{setSummary(result);setPhase('summary');announceXpChanged();}} />;

  if (phase === "summary" && summary) {
    return <SummaryScreen summary={summary} nextChapterId={nextChapterId} term={term} courseId={courseId} />;
  }

  return null;
}

/** Gedeelde vraagkaarten, correctieronde en retry; inhoud en XP blijven serverwerk. */
export function ExerciseSessionQuestions<Result>({
  exercises,
  review,
  submit,
  onComplete,
  onCheck,
  feedbackContext,
  groupForIndex,
  initialCheckpoint,
  onCheckpoint,
}: {
  exercises: Exercise[];
  review: boolean;
  submit: (answers: SubmittedAnswer[]) => Promise<Result>;
  onComplete: (result: Result) => void;
  onCheck?: (
    exercise: Exercise,
    given: string[],
  ) => Promise<{ correct: boolean; correctAnswer: string[] | null }>;
  feedbackContext?: (exercise: Exercise) => ExerciseFeedbackContext;
  groupForIndex?: (index: number) => string;
  initialCheckpoint?: ExerciseCheckpoint | null;
  onCheckpoint?: (checkpoint: ExerciseCheckpoint) => void;
}) {
  const t = useT();
  const [index, setIndex] = useState(initialCheckpoint?.index ?? 0),
    [answers, setAnswers] = useState<SubmittedAnswer[]>(initialCheckpoint?.answers ?? []);
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(initialCheckpoint?.reviewQueue ?? null),
    [reviewPos, setReviewPos] = useState(initialCheckpoint?.reviewPos ?? 0);
  const [pending, setPending] = useState<SubmittedAnswer[] | null>(initialCheckpoint?.pending ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(initialCheckpoint?.pending ? t("apiErrors.notSaved") : null);
  useEffect(()=>{ onCheckpoint?.({index,answers,reviewQueue,reviewPos,pending}); },[index,answers,reviewQueue,reviewPos,pending,onCheckpoint]);
  const current = reviewQueue
    ? exercises.find((e) => e.id === reviewQueue[reviewPos])
    : exercises[index];
  async function finish(final: SubmittedAnswer[]) {
    if (busy) return;
    setPending(final);
    setBusy(true);
    setError(null);
    try {
      onComplete(await submit(final));
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) && !(e instanceof SyntaxError) ? e.message : t("courses.error"));
    } finally {
      setBusy(false);
    }
  }
  function advance(final: SubmittedAnswer[]) {
    if (reviewQueue) {
      if (reviewPos + 1 < reviewQueue.length) setReviewPos(reviewPos + 1);
      else void finish(final);
    } else if (index + 1 < exercises.length) setIndex(index + 1);
    else {
      const wrong = review
        ? final.filter((a) => !a.correct).map((a) => a.exerciseId)
        : [];
      if (wrong.length) {
        setReviewQueue(wrong);
        setReviewPos(0);
      } else void finish(final);
    }
  }
  function done(given: string[], correct: boolean) {
    if (!current) return;
    const final = reviewQueue
      ? answers.map((a) =>
          a.exerciseId === current.id ? { ...a, given, correct } : a,
        )
      : [...answers, { exerciseId: current.id, given, correct }];
    setAnswers(final);
    advance(final);
  }
  return (
    <FocusLayout className="max-w-2xl gap-6">
      {groupForIndex && !reviewQueue && (
        <p className="font-bold text-vs-fg" data-exercise-group>
          {groupForIndex(index)}
        </p>
      )}
      {reviewQueue && !pending && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-extrabold">
              {t("lesson.reviewTitle", {
                pos: reviewPos + 1,
                total: reviewQueue.length,
              })}
            </h2>
            <button
              className="btn-secondary !px-3"
              disabled={busy}
              onClick={() => void finish(answers)}
            >
              {t("lesson.skipAll")}
            </button>
          </div>
          <p className="text-sm text-vs-fg-2">{t("lesson.reviewHint")}</p>
        </>
      )}
      {!pending && current && (
        <ExerciseCard
          key={(reviewQueue ? "review:" : "question:") + current.id}
          exercise={current}
          onDone={done}
          onSkip={reviewQueue ? () => advance(answers) : undefined}
          disabled={busy}
          focus
          progress={{
            current: reviewQueue ? reviewPos : index,
            total: reviewQueue ? reviewQueue.length : exercises.length,
          }}
          onCheck={onCheck ? (given) => onCheck(current, given) : undefined}
          feedbackContext={feedbackContext?.(current)}
        />
      )}
      {busy && <p role="status">{t("courses.busy")}</p>}
      {error && (
        <div role="alert">
          <p className="text-vs-danger">{error}</p>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => pending && void finish(pending)}
          >
            {t("studyReader.retry")}
          </button>
        </div>
      )}
    </FocusLayout>
  );
}

export function ReaderView({
  chapterId,
  bookName,
  chapterNumber,
  verses,
  audio,
  term = chapterTerm(null),
  focusVerse,
  language,
  focus = false,
  preview = false,
}: {
  chapterId: string;
  bookName: string;
  chapterNumber: number;
  verses: VerseView[];
  audio?: ChapterAudio | null;
  term?: ChapterTerm;
  focusVerse?: number;
  language?: string;
  focus?: boolean;
  /** Alleen lezen: geen audio-opvraag of gebruikersacties die data opslaan. */
  preview?: boolean;
}) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [annotationTarget,setAnnotationTarget] = useState<{verseId:string;element:HTMLElement}|null>(null);
  const annotations = useLiveQuery<AnnotationList>(["annotations","chapter",chapterId],()=>fetchJson(`/api/annotations?view=reader&chapterId=${encodeURIComponent(chapterId)}`),{scopes:["annotations"],contentScoped:true,enabled:!preview});
  const [confirmed,setConfirmed]=useState<Record<string,Partial<VerseView>>>({});
  const verseState = verses.map(verse=>{
    const own=annotations.data?.annotations.filter(row=>row.target.type==='verse'&&row.target.verseId===verse.id);
    if(!own||!annotations.data?.complete)return {...verse,...confirmed[verse.id]};
    return {...verse,bookmarked:own.some(r=>r.kind==='bookmark'),highlighted:own.some(r=>r.kind==='highlight'),note:own.find(r=>r.kind==='note')?.text??''};
  });
  function annotationChanged(row:AnnotationView){if(row.target.type==='verse'){const id=row.target.verseId;setConfirmed(old=>({...old,[id]:{...old[id],...(row.kind==='bookmark'?{bookmarked:!row.deleted}:row.kind==='highlight'?{highlighted:!row.deleted}:{note:row.deleted?'':row.text??''})}}));}annotations.setData(old=>old?{...old,annotations:[...old.annotations.filter(r=>r.id!==row.id),...(!row.deleted?[row]:[])]}:old);}

  const { source, currentIndex, isPlaying } = useReadAloudPlayer();
  const readingVerse = !preview && source && source.id === chapterId && isPlaying ? source.verses[currentIndex]?.number ?? null : null;
  // Het opgevraagde vers licht even op, zodat je ziet waar je bent beland.
  const [flashVerse, setFlashVerse] = useState<number | null>(focusVerse ?? null);

  useEffect(() => {
    if (!focusVerse) return;
    document.getElementById(`vers-${focusVerse}`)?.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => setFlashVerse(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusVerse]);

  useEffect(() => {
    if (!readingVerse) return;
    document.getElementById(`vers-${readingVerse}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [readingVerse]);


  useEffect(() => {
    try {
      const stored = localStorage.getItem(FONT_SCALE_KEY);
      if (stored) setScale(parseFloat(stored));
    } catch {
      // negeren
    }
  }, []);

  const readAloud = useRef<ReadAloudControl | null>(null);
  const [audioStatus, setAudioStatus] = useState<ReadAloudStatus>("loading");
  const pointerStart = useRef<{ x: number; y: number; hadSelection: boolean } | null>(null);
  function rememberPointer(event: React.PointerEvent) {
    pointerStart.current = { x: event.clientX, y: event.clientY, hadSelection: !(window.getSelection()?.isCollapsed ?? true) };
  }
  // Een tik opent het menu; selecteren, slepen en scrollen niet.
  function tapVerse(event: React.MouseEvent<HTMLElement>, verseId: string) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    if (start?.hadSelection || !(window.getSelection()?.isCollapsed ?? true)) return;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    const number = event.currentTarget.querySelector<HTMLElement>("[data-annotation-trigger]");
    setAnnotationTarget({ verseId, element: number ?? event.currentTarget });
  }
  function startReading(number: number) {
    return readAloud.current?.startAtVerse(number) ?? false;
  }
  function audioFor(verseId: string) {
    const verse = verses.find((item) => item.id === verseId);
    if (!verse) return undefined;
    return {
      label: t("annotations.readFrom", { number: verse.number }),
      status: audioStatus,
      onStart: () => startReading(verse.number),
      onRetry: () => readAloud.current?.retry(),
    };
  }

  function changeScale(delta: number) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((scale + delta) * 100) / 100));
    setScale(next);
    try {
      localStorage.setItem(FONT_SCALE_KEY, String(next));
    } catch {
      // negeren
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
          {bookName} {chapterNumber}
        </h1>
        <div className="flex items-center gap-1 text-sm">
          <button
            aria-label={t("lesson.smallerText")}
            className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
            onClick={() => changeScale(-0.1)}
          >
            A-
          </button>
          <button
            aria-label={t("lesson.largerText")}
            className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
            onClick={() => changeScale(0.1)}
          >
            A+
          </button>
        </div>
      </div>

      {!preview && <ReadAloudPlayer
          sourceId={chapterId}
          title={`${bookName} ${chapterNumber}`}
          verses={verseState.map((v) => ({ number: v.number, text: v.text, audioStart: v.audioStart }))}
          audio={audio}
          subtitle={t("lesson.listenTo", { thisOne: term.thisOne })}
          language={language}
          controlRef={readAloud}
          onStatusChange={setAudioStatus}
        />}

      {!preview && annotations.data && !annotations.data.complete && <p role="status">{t("annotations.incomplete")}</p>}
      {!preview && !!annotations.error && <p role="alert">{t("annotations.failed")}</p>}
      <div className={`${focus ? "" : "card "}flex flex-col gap-1`} style={{ "--reader-font-scale": scale } as React.CSSProperties}>
        {verseState.map((v) => {
          const mark = annotations.data?.annotations.find(row=>row.kind==='highlight'&&row.target.type==='verse'&&row.target.verseId===v.id)?.color;
          // Markeringskleur, selectie, voorlezen en focus staan op aparte lagen: de ring (voorlezen/selectie/focus) laat
          // de kleurlaag van een expliciete markering ongemoeid. De gouden vangnetkleur geldt alleen zolang de kleur nog onbekend is.
          const ring = flashVerse === v.number
            ? "ring-2 ring-brand-400 dark:ring-brand-500"
            : annotationTarget?.verseId === v.id
            ? "ring-2 ring-brand-300 dark:ring-brand-600"
            : readingVerse === v.number
              ? "ring-2 ring-brand-300/70 dark:ring-brand-600/70"
              : "";
          const surface = mark ? "" : flashVerse === v.number
            ? "bg-brand-100/70 dark:bg-brand-900/30"
            : annotationTarget?.verseId === v.id
            ? "bg-brand-50 dark:bg-brand-900/20"
            : v.highlighted
            ? "bg-gold-400/20 dark:bg-gold-400/10"
            : readingVerse === v.number
              ? "bg-brand-100/70 dark:bg-brand-900/30"
              : "";
          return (
          <div
            key={v.id}
            id={`vers-${v.number}`}
            data-annotation-color={mark}
            onPointerDown={preview ? undefined : rememberPointer}
            onClick={preview ? undefined : (event) => tapVerse(event, v.id)}
            className={`reader-text rounded-xl -mx-2 px-2 py-1 transition-colors duration-700 ${preview ? "" : "cursor-pointer"} ${ring} ${surface}`}
          >
            <p className="whitespace-pre-line">
              {preview ? (
                <span className="text-brand-400 dark:text-brand-500 font-bold mr-2 select-none">{v.number}</span>
              ) : (
                <button
                  type="button"
                  data-annotation-trigger
                  aria-haspopup="dialog"
                  aria-label={t("annotations.verseActions", { number: v.number })}
                  onClick={(event) => {
                    event.stopPropagation();
                    setAnnotationTarget({ verseId: v.id, element: event.currentTarget });
                  }}
                  className="mr-2 inline cursor-pointer select-none align-baseline font-bold text-brand-400 dark:text-brand-500 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vs-accent"
                >
                  {v.number}
                  {(v.bookmarked || v.note || mark) && (
                    <span className="ml-0.5 inline-flex gap-0.5 align-[-0.1em] text-vs-accent">
                      {mark && <Highlighter aria-hidden className="h-[0.8em] w-[0.8em]" style={{ color: "rgb(var(--m))" }} />}
                      {v.bookmarked && <Bookmark aria-hidden className="h-[0.8em] w-[0.8em] fill-current" />}
                      {v.note && <StickyNote aria-hidden className="h-[0.8em] w-[0.8em]" />}
                    </span>
                  )}
                </button>
              )}
              {v.text}
            </p>
          </div>
          );
        })}
      </div>
      {!preview && annotationTarget && verses.some(v=>v.id===annotationTarget.verseId) && <AnnotationActions key={annotationTarget.verseId} target={{type:'verse',verseId:annotationTarget.verseId}} returnFocus={annotationTarget.element} onClose={()=>setAnnotationTarget(null)} onChanged={annotationChanged} audio={audioFor(annotationTarget.verseId)}/>}
    </>
  );
}

function formatCorrectAnswer(type: Exercise["type"], correctAnswer: string[], t: TFunction): string {
  if (type === "TRUE_FALSE") return correctAnswer[0] === "true" ? t("lesson.true") : t("lesson.false");
  return correctAnswer.join(" ");
}

function HintControl({ exercise, checked }: { exercise: Exercise; checked: boolean }) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const [hintCredits, setHintCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/hints")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.hintBalance === "number") setHintCredits(data.hintBalance);
      })
      .catch(() => {});
  }, []);

  async function showHint() {
    if (loading || checked || hint) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/exercises/${exercise.id}/hint`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("lesson.hintFailed"));
        return;
      }
      setHint(typeof data.hint === "string" ? data.hint : null);
      setHintCredits(typeof data.hintBalance === "number" ? data.hintBalance : hintCredits);
    } catch {
      setError(t("lesson.hintFailed"));
    } finally {
      setLoading(false);
    }
  }

  if (hint) {
    return (
      <div className="rounded-2xl bg-gold-50 dark:bg-slate-700 px-4 py-3">
        <p className="font-extrabold text-gold-700 dark:text-gold-300">💡 {t("lesson.hint")}</p>
        <p className="text-sm text-gold-700/90 dark:text-gold-200 mt-1">{hint}</p>
        {hintCredits !== null && (
          <p className="text-xs text-gold-600 dark:text-gold-300 mt-2 font-bold">
            {hintCredits === 1 ? t("lesson.hintsLeftOne", { n: hintCredits }) : t("lesson.hintsLeftMany", { n: hintCredits })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="btn-secondary self-start"
        disabled={loading || checked || hintCredits === 0}
        onClick={showHint}
      >
        {loading ? t("lesson.hintLoading") : `💡 ${t("lesson.hint")}${hintCredits === null ? "" : ` · ${hintCredits}`}`}
      </button>
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}


export function ExerciseCard({
  exercise,
  onDone,
  onSkip,
  disabled,
  checkEndpoint,
  onCheck,
  showHint = true,
  focus = false,
  progress,
  feedbackContext,
}: {
  exercise: Exercise;
  onDone: (given: string[], correct: boolean) => void;
  onSkip?: () => void;
  disabled: boolean;
  /** Standaard /api/exercises/{id}/check — voor bv. podcastoefeningen kan een ander endpoint meegegeven worden. */
  checkEndpoint?: string;
  /** Eigen controle in plaats van een endpoint, bv. via de socket bij Samen studeren (daar telt ook het tijdstip). */
  onCheck?: (given: string[]) => Promise<{ correct: boolean; correctAnswer: string[] | null }>;
  /** Hints uit bij een wedstrijd tegen anderen, waar iedereen gelijke kansen moet hebben. */
  showHint?: boolean;
  /** Een actieve focusflow gebruikt de pagina zelf als canvas i.p.v. een buitenkaart. */
  focus?: boolean;
  /** Progressie binnen deze uitgedeelde oefenset/stap. */
  progress?: { current: number; total: number };
  /** Server-gevalideerde context voor de gedeelde vraagfeedback. */
  feedbackContext?: ExerciseFeedbackContext;
}) {
  const t = useT();
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState<string[] | null>(null);
  const [givenAnswer, setGivenAnswer] = useState<string[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ word: string; poolIndex: number }[]>([]);
  const [trueFalseAnswer, setTrueFalseAnswer] = useState<"true" | "false" | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const pool = useMemo(() => exercise.wordBank ?? [], [exercise]);
  const availablePool = pool
    .map((word, poolIndex) => ({ word, poolIndex }))
    .filter(({ poolIndex }) => !placed.some((p) => p.poolIndex === poolIndex));

  const promptParts = exercise.prompt.split(/____/);

  const canCheck =
    exercise.type === "FILL_BLANK" || exercise.type === "MULTIPLE_CHOICE" || exercise.type === "IMAGE_CHOICE"
      ? choice !== null
      : exercise.type === "TRUE_FALSE"
        ? trueFalseAnswer !== null
        : placed.length === exercise.blanks;

  async function check() {
    if (checking || checked) return;
    const given =
      exercise.type === "FILL_BLANK" || exercise.type === "MULTIPLE_CHOICE" || exercise.type === "IMAGE_CHOICE"
        ? [choice ?? ""]
        : exercise.type === "TRUE_FALSE"
          ? [trueFalseAnswer ?? "true"]
          : placed.map((p) => p.word);

    setChecking(true);
    try {
      if (onCheck) {
        const result = await onCheck(given);
        setWasCorrect(result.correct);
        setCorrectAnswer(result.correctAnswer);
        setGivenAnswer(given);
        return;
      }
      const res = await fetch(checkEndpoint ?? `/api/exercises/${exercise.id}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ given }),
      });
      const data = await res.json();
      setWasCorrect(Boolean(data.correct));
      setCorrectAnswer(Array.isArray(data.correctAnswer) ? data.correctAnswer : null);
      setGivenAnswer(given);
    } catch {
      setWasCorrect(false);
      setCorrectAnswer(null);
      setGivenAnswer(given);
    } finally {
      setChecking(false);
      setChecked(true);
    }
  }

  function next() {
    onDone(givenAnswer, wasCorrect);
  }

  const mascotReaction = <ExerciseMascotReaction checked={checked} correct={wasCorrect} />;
  const surfaceClass = focus ? "flex min-h-[calc(100dvh-var(--header-height,var(--header-default))-2rem)] flex-col gap-5" : "card flex flex-col gap-5";
  const givenFeedbackContext = feedbackContext
    ? { ...feedbackContext, givenAnswer }
    : undefined;
  const progressState = progress ? exerciseProgress(progress.current, progress.total, checked) : null;

  const actionArea = (
    <ExerciseActionArea
      focus={focus}
      checked={checked}
      wasCorrect={wasCorrect}
      correctAnswer={correctAnswer}
      exerciseType={exercise.type}
      feedbackContext={givenFeedbackContext}
      feedbackSent={feedbackSent}
      onOpenFeedback={() => setFeedbackOpen(true)}
      onCheck={check}
      onNext={next}
      onSkip={onSkip}
      checking={checking}
      canCheck={canCheck}
      disabled={disabled}
    />
  );

  const progressHeader = progressState && (
    <div className="sticky top-[var(--header-offset,var(--header-default))] z-10 -mx-1 bg-vs-app/95 py-2 backdrop-blur sm:-mx-2" data-exercise-progress>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-extrabold uppercase tracking-wide text-vs-fg-3">
        <span>{t("lesson.exerciseProgress")}</span>
        <span>{progressState.answered}/{progressState.total}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-vs-line" aria-label={`${progressState.answered}/${progressState.total}`}>
        <div className="h-full rounded-full bg-vs-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progressState.percent}%` }} />
      </div>
    </div>
  );

  const feedbackSheet = feedbackOpen && givenFeedbackContext && (
    <ExerciseFeedbackSheet
      context={givenFeedbackContext}
      onClose={() => setFeedbackOpen(false)}
      onSubmitted={() => {
        setFeedbackOpen(false);
        setFeedbackSent(true);
      }}
    />
  );

  if (exercise.type === "TRUE_FALSE") {
    return (
      <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{exercise.verseRef}</p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">{exercise.prompt}</p>
        <div className="flex gap-3">
          {(["true", "false"] as const).map((value) => {
            const isCorrectValue = checked && correctAnswer?.[0] === value;
            const isWrongPick = checked && trueFalseAnswer === value && !isCorrectValue;
            return (
              <button
                key={value}
                disabled={checked}
                onClick={() => setTrueFalseAnswer(value)}
                className={`btn flex-1 border-2 ${
                  isCorrectValue
                    ? "bg-brand-500 text-white border-brand-500"
                    : isWrongPick
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 border-red-400"
                      : trueFalseAnswer === value
                        ? "bg-brand-500 text-white border-brand-500"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600"
                }`}
              >
                {value === "true" ? `✅ ${t("lesson.true")}` : `❌ ${t("lesson.false")}`}
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  if (exercise.type === "FILL_BLANK") {
    const options = exercise.options ?? [];

    // Oudere content (van vóór keuzeopties bestonden) heeft geen opties —
    // nooit een doodlopende weg tonen, gewoon doorlaten zonder score.
    if (options.length === 0) {
      return (
        <div className={surfaceClass}>
          {progressHeader}
          <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{exercise.verseRef}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("lesson.outdated")}
          </p>
          <button className="btn-primary self-end" disabled={disabled} onClick={() => onDone([""], false)}>
            Doorgaan →
          </button>
        </div>
      );
    }

    return (
      <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{exercise.verseRef}</p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">
          {promptParts.map((part, i) => (
            <span key={i}>
              {part}
              {i < promptParts.length - 1 && (
                <span className="inline-block mx-1 px-3 py-0.5 rounded-lg border-b-2 border-dashed border-brand-400 font-bold text-brand-500 dark:text-brand-300">
                  {checked ? choice ?? "…" : "____"}
                </span>
              )}
            </span>
          ))}
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
          {options.map((opt) => {
            const isCorrectOption = checked && correctAnswer && normalizeAnswer(opt) === normalizeAnswer(correctAnswer[0] ?? "");
            const isWrongPick = checked && choice === opt && !isCorrectOption;
            return (
              <button
                key={opt}
                disabled={checked}
                onClick={() => setChoice(opt)}
                className={`btn text-left border-2 ${
                  isCorrectOption
                    ? "bg-brand-500 text-white border-brand-500"
                    : isWrongPick
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 border-red-400"
                      : choice === opt
                        ? "bg-brand-500 text-white border-brand-500"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  if (exercise.type === "MULTIPLE_CHOICE") {
    const options = exercise.options ?? [];
    return (
        <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{exercise.verseRef}</p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">{exercise.prompt}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {options.map((opt) => {
            const isCorrectOption = checked && correctAnswer && normalizeAnswer(opt) === normalizeAnswer(correctAnswer[0] ?? "");
            const isWrongPick = checked && choice === opt && !isCorrectOption;
            return (
              <button
                key={opt}
                disabled={checked}
                onClick={() => setChoice(opt)}
                className={`btn text-left border-2 ${
                  isCorrectOption
                    ? "bg-brand-500 text-white border-brand-500"
                    : isWrongPick
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 border-red-400"
                      : choice === opt
                        ? "bg-brand-500 text-white border-brand-500"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  if (exercise.type === "IMAGE_CHOICE") {
    const options = exercise.options ?? [];
    return (
      <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{exercise.verseRef}</p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">{exercise.prompt}</p>
        <div className="grid grid-cols-2 gap-3">
          {options.map((opt) => {
            const isCorrectOption = checked && correctAnswer && normalizeAnswer(opt) === normalizeAnswer(correctAnswer[0] ?? "");
            const isWrongPick = checked && choice === opt && !isCorrectOption;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <button
                key={opt}
                disabled={checked}
                onClick={() => setChoice(opt)}
                className={`rounded-2xl overflow-hidden border-4 transition ${
                  isCorrectOption
                    ? "border-brand-500"
                    : isWrongPick
                      ? "border-red-400"
                      : choice === opt
                        ? "border-brand-500"
                        : "border-transparent hover:border-brand-300"
                }`}
              >
                <img src={opt} alt="" className="w-full h-auto block" />
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  // WORD_BANK / SEQUENCE — zelfde mechaniek (items in de juiste volgorde
  // aantikken), SEQUENCE gebruikt alleen langere zinnen i.p.v. losse woorden.
  return (
    <div className={surfaceClass}>
      {progressHeader}
      <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{exercise.verseRef}</p>
      {showHint && <HintControl exercise={exercise} checked={checked} />}
      {mascotReaction}
      <p className="text-xl leading-relaxed dark:text-slate-100">{exercise.prompt}</p>

      <div className="flex flex-wrap gap-2 min-h-[3rem] p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700">
        {placed.length === 0 && (
          <span className="text-slate-400 dark:text-slate-500 text-sm">
            {exercise.type === "SEQUENCE"
              ? t("lesson.tapEvents")
              : t("lesson.tapWords")}
          </span>
        )}
        {placed.map((p, i) => (
          <button
            key={i}
            disabled={checked}
            onClick={() => setPlaced(placed.filter((_, idx) => idx !== i))}
            className="rounded-xl bg-brand-500 text-white px-3 py-1.5 font-bold"
          >
            {p.word}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {availablePool.map(({ word, poolIndex }) => (
          <button
            key={poolIndex}
            disabled={checked}
            onClick={() => setPlaced([...placed, { word, poolIndex }])}
            className="rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 border-2 border-slate-200 dark:border-slate-600 px-3 py-1.5 font-bold hover:border-brand-300"
          >
            {word}
          </button>
        ))}
      </div>

      {actionArea}
      {feedbackSheet}
    </div>
  );
}

function ExerciseMascotReaction({ checked, correct }: { checked: boolean; correct: boolean }) {
  const state = checked ? (correct ? "success" : "encourage") : "thinking";
  return <div className="mx-auto aspect-square w-16 shrink-0 sm:w-20"><PersonalMascot state={state} size={96} fill /></div>;
}

export function LessonResultMascot({ scorePercent, celebrate = false, successThreshold = 50 }: { scorePercent: number; celebrate?: boolean; successThreshold?: number }) {
  const state = celebrate ? "celebrate" : scorePercent >= successThreshold ? "success" : "encourage";
  return (
    <div className="aspect-square w-[clamp(110px,30vw,8.125rem)] shrink-0 sm:w-36 vs-decor">
      <PersonalMascot state={state} size={144} fill />
    </div>
  );
}

function ExerciseActionArea({
  checked,
  checking,
  canCheck,
  disabled,
  onCheck,
  onNext,
  onSkip,
  focus,
  wasCorrect,
  correctAnswer,
  exerciseType,
  feedbackContext,
  feedbackSent,
  onOpenFeedback,
}: {
  checked: boolean;
  checking: boolean;
  canCheck: boolean;
  disabled: boolean;
  onCheck: () => void;
  onNext: () => void;
  onSkip?: () => void;
  focus: boolean;
  wasCorrect: boolean;
  correctAnswer: string[] | null;
  exerciseType: Exercise["type"];
  feedbackContext?: ExerciseFeedbackContext & { givenAnswer: string[] };
  feedbackSent: boolean;
  onOpenFeedback: () => void;
}) {
  const t = useT();
  return (
    <div className={focus ? "sticky bottom-0 z-20 -mx-4 mt-auto border-t border-vs-line bg-vs-elevated/95 px-4 pt-3 pb-[max(1rem,var(--vs-safe-area-bottom))] backdrop-blur sm:-mx-2 sm:px-2" : "mt-2"} data-exercise-action-area>
      {checked && (
        <div className="mb-3" aria-live="polite">
          <div className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2 font-extrabold ${wasCorrect ? "bg-vs-success-soft text-vs-success" : "bg-vs-danger-soft text-vs-danger"}`}>
            <span className="inline-flex min-w-0 items-center gap-2">
              {wasCorrect ? <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /> : <XCircle className="h-5 w-5 shrink-0" aria-hidden />}
              {wasCorrect ? t("lesson.correctTitle") : t("lesson.wrongTitle")}
            </span>
            {feedbackContext && (
              <button type="button" onClick={onOpenFeedback} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-current/70 hover:bg-black/5 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current" aria-label={t("feedback.exercise.reportQuestion")}>
                <Flag className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {!wasCorrect && <p className="mt-2 px-1 text-sm font-semibold text-vs-fg-2">{exerciseType === "IMAGE_CHOICE" ? t("lesson.wrongImage") : t("lesson.wrongAnswer", { answer: formatCorrectAnswer(exerciseType, correctAnswer ?? [], t) })}</p>}
          {feedbackSent && <p className="mt-2 px-1 text-sm font-bold text-vs-success" role="status">{t("feedback.exercise.sent")}</p>}
        </div>
      )}
      {!checked ? (
        <div className="flex flex-wrap items-center gap-3">
          {onSkip ? (
            <button className="text-sm font-bold text-vs-fg-3 hover:text-vs-fg" disabled={disabled} onClick={onSkip}>
              {t("lesson.skip")}
            </button>
          ) : null}
          <button className={`${focus ? "w-full !px-2" : "ml-auto"} btn-primary min-h-12`} disabled={!canCheck || disabled || checking} onClick={onCheck}>
            {checking ? t("lesson.checking") : t("lesson.check")}
          </button>
        </div>
      ) : (
        <button className={`btn-primary min-h-12 w-full animate-pop ${focus ? "!px-2" : ""}`} disabled={disabled} onClick={onNext}>
          {disabled ? t("courses.busy") : t("lesson.continue")}
        </button>
      )}
    </div>
  );
}

export function SummaryScreen({
  summary,
  nextChapterId,
  term,
  courseId,
  returnHref,
}: {
  summary: SummaryResult;
  nextChapterId: string | null;
  term: ChapterTerm;
  courseId?: string;
  returnHref?: string;
}) {
  const t = useT();
  return (
    <FocusLayout className="max-w-2xl items-center gap-4 py-4 text-center animate-pop sm:py-8">
      <LessonResultMascot scorePercent={summary.scorePercent} celebrate={summary.newAchievements.length > 0} />
      <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
        {t("lesson.score", { correct: summary.correctCount, total: summary.total, pct: summary.scorePercent })}
      </h2>
      <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">+{summary.xpEarned} XP</p>
      {summary.baseXp + summary.bonusXp === 0 && summary.total > 0 && (
        <p className="-mt-2 text-sm text-vs-fg-2">{t("progress.repeatNote")}</p>
      )}
      {summary.content && (
        <ContentStatusLine read={summary.content.read} exercisesAnswered={summary.content.exercisesAnswered} exercisesTotal={summary.content.exercisesTotal} className="justify-center" />
      )}

      <div className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-3">
        <StreakContinuationCard />
        <div>
          <div className="flex items-center gap-1 text-xl font-extrabold text-ice-600"><SystemIcon kind="freeze" className="h-5 w-5" aria-hidden />{summary.freezeCount}</div>
          <div className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase">{t("lesson.freezes")}</div>
        </div>
      </div>

      {summary.freezeUsed && (
        <p className="text-sm bg-ice-50 dark:bg-slate-700 text-ice-600 dark:text-ice-400 rounded-xl px-3 py-2">
          {t("lesson.freezeUsed")}
        </p>
      )}
      {summary.streakBroken && !summary.freezeUsed && (
        <p className="text-sm bg-red-50 dark:bg-slate-700 text-red-500 dark:text-red-400 rounded-xl px-3 py-2">
          {t("lesson.streakBroken")}
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
                  <AchievementIcon slug={slug} fallbackIcon={display.icon} className="h-9 w-9" />
                  <span className="text-xs font-bold dark:text-slate-200">{translateOr(t, `achievements.${slug}.name`, display.name)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-4">
        <Link href={returnHref??"/dashboard"} replace={!!returnHref} className="btn-secondary">
          {t(returnHref?"misc.backToLesson":"lesson.backToLessons")}
        </Link>
        {nextChapterId && (
          <Link href={`/lesson/${nextChapterId}${courseId ? `?cursus=${courseId}` : ""}`} className="btn-primary">
            {t(`terms.${term.kind}.next`)}
          </Link>
        )}
      </div>
    </FocusLayout>
  );
}
