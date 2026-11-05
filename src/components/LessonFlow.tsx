"use client";

import {ExerciseSessionQuestions,type Exercise} from "@/components/learning/ExerciseSessionQuestions";
import {SummaryScreen as SharedSummaryScreen,type SummaryScreenProps,type SummaryResult} from "@/components/learning/LessonSummary";
export {ExerciseCard,ExerciseSessionQuestions,LessonResultMascot} from "@/components/learning/ExerciseSessionQuestions";
export type {Exercise,ExerciseType} from "@/components/learning/ExerciseSessionQuestions";
export type {SummaryResult} from "@/components/learning/LessonSummary";


import { useVerseAnnotationMenu } from "@/components/annotations/useVerseAnnotationMenu";
import ScriptureReaderView from "@/components/reading/ScriptureReaderView";
import AnnotationActions from "@/components/annotations/AnnotationActions";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import type { AnnotationList, AnnotationView } from "@/lib/annotations/clientContract";
import { StreakContinuationCard } from "@/components/StreakContinuation";


import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useActivityStatus } from "@/lib/useActivity";
import { announceXpChanged } from "@/lib/xpBroadcast";
import ReadAloudPlayer, { type ReadAloudControl, type ReadAloudStatus } from "@/components/ReadAloudPlayer";
import { useReadAloudPlayer } from "@/lib/readAloudPlayerContext";
import { chapterTerm, type ChapterTerm } from "@/lib/chapterTerm";
import { ContentStatusLine, LongChapterNotice, type ReadState } from "@/components/learning/ContentStatus";
import FocusLayout from "@/components/versado/FocusLayout";

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
  const readAloud = useRef<ReadAloudControl | null>(null);
  const [audioStatus, setAudioStatus] = useState<ReadAloudStatus>("loading");
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

  const colorForVerse = (id:string) => annotations.data?.annotations.find(row=>row.kind==='highlight'&&row.target.type==='verse'&&row.target.verseId===id)?.color;
  const menu=useVerseAnnotationMenu(!preview,colorForVerse),annotationTarget=menu.target;
  return <ScriptureReaderView bookName={bookName} chapterNumber={chapterNumber} verses={verseState} focus={focus} focusVerse={focusVerse} readingVerse={readingVerse} language={language} {...menu.props} beforeVerses={<>
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
    </>} afterVerses={<>
      {!preview && annotationTarget && verses.some(v=>v.id===annotationTarget.verseId) && <AnnotationActions key={annotationTarget.verseId} target={{type:'verse',verseId:annotationTarget.verseId}} returnFocus={annotationTarget.element} onClose={menu.close} onChanged={annotationChanged} audio={audioFor(annotationTarget.verseId)}/>}    </>}/>;
}

export function SummaryScreen(props: SummaryScreenProps) {
  return <SharedSummaryScreen {...props} streakContinuation={<StreakContinuationCard />} />;
}
