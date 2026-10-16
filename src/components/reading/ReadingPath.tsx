"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, Lock } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { ContentStatusLine } from "@/components/learning/ContentStatus";
import { artworkFor, chapterArtworkKeys } from "@/lib/artwork";
import { focusRing, primaryButton, surfaceCard } from "@/components/versado/styles";
import { currentEntryKey } from "@/lib/navigationHistory";
import { requestScrollRestore } from "@/lib/scrollRestore";
import {
  chapterPercent,
  chapterState,
  pathScrollTarget,
  stepState,
  type PathChapter,
  type PathChapterState,
  type PathStep,
} from "@/lib/readingPath";

// Het leerpad van Stap voor stap: elk schriftuurlijk hoofdstuk is één onderdeel van één verticale
// route, in de volgorde van de cursus. Alleen presentatie: wat open, af of vergrendeld is komt
// uit de server (getStepOverview); een stap blijft lezen + vragen via de bestaande lesroute.

// Breedte van de route links; vaste px zodat de lijn bij grotere tekst niet meegroeit en de kaarten
// de ruimte houden (docs/LAYOUT.md: decoratief naast tekst heeft een px-maat).
const RAIL = 38;
const NODE_CENTER_Y = 28;
// Middelpunt van de knoop per hoofdstuk; afwisselend links en rechts geeft de lichte slinger.
const WIGGLE = [15, 23] as const;

function railX(index: number): number {
  return WIGGLE[index % 2];
}

function cssPx(name: string): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/** Waar het venster moet staan om de actieve stap (en het hoofdstuk ervoor) te tonen; null zolang hij er niet is. */
function currentScrollTarget(): number | null {
  const card = document.querySelector<HTMLElement>("[data-path-current]");
  const step = card?.querySelector<HTMLElement>("[data-current-step]");
  if (!card || !step) return null;
  const doc = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  const previous = card.previousElementSibling as HTMLElement | null;
  const stepTop = doc(step);
  return pathScrollTarget({
    previousTop: previous ? doc(previous) : null,
    cardTop: doc(card),
    stepTop,
    stepBottom: stepTop + step.getBoundingClientRect().height,
    header: cssPx("--header-offset"),
    nav: cssPx("--nav-height"),
    viewport: window.innerHeight,
  });
}

export default function ReadingPath({
  chapters,
  currentStepId,
}: {
  chapters: PathChapter[];
  currentStepId: string | null;
}) {
  const t = useT();
  // Wat de gebruiker zelf openklapte; het actieve hoofdstuk staat altijd open (ook na een nieuwe actieve stap).
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [away, setAway] = useState(false);

  // Bij het openen staat de actieve stap in beeld. Het scrollcoördinatiepunt (NavigationScroll) bepaalt of
  // dat mag: terug/vooruit herstelt de oude positie en wie al scrolde of tikte wordt nooit overschreven.
  useEffect(() => {
    if (!currentStepId) return;
    requestScrollRestore(currentEntryKey(), "position", currentScrollTarget);
  }, [currentStepId]);

  // "Mijn stap" alleen als de actieve stap buiten beeld is geraakt.
  useEffect(() => {
    if (!currentStepId) return;
    const step = document.querySelector<HTMLElement>("[data-current-step]");
    if (!step || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setAway(!entry.isIntersecting), { threshold: 0 });
    observer.observe(step);
    return () => observer.disconnect();
  }, [currentStepId]);

  function toggle(id: string) {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goToMyStep() {
    const top = currentScrollTarget();
    if (top === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }

  const states = useMemo(() => chapters.map((chapter) => chapterState(chapter, currentStepId)), [chapters, currentStepId]);

  return (
    <div>
      <ol aria-label={t("courseView.path.label")} data-reading-path className="m-0 list-none p-0">
        {chapters.map((chapter, index) => (
          <PathChapterItem
            key={chapter.id}
            chapter={chapter}
            state={states[index]}
            index={index}
            isLast={index === chapters.length - 1}
            open={opened.has(chapter.id)}
            onToggle={() => toggle(chapter.id)}
            currentStepId={currentStepId}
          />
        ))}
      </ol>
      {away && (
        <button
          type="button"
          onClick={goToMyStep}
          aria-label={t("courseView.path.myStepAria")}
          data-my-step
          className={`${primaryButton} vs-rise fixed right-4 z-20 shadow-lg bottom-[calc(var(--nav-height,0px)+var(--vs-safe-area-bottom,0px)+1rem)]`}
        >
          <ArrowUp className="h-4 w-4 shrink-0" aria-hidden />
          {t("courseView.path.myStep")}
        </button>
      )}
    </div>
  );
}

function Node({ state, index }: { state: PathChapterState; index: number }) {
  const base = "absolute flex items-center justify-center rounded-full";
  const big = state === "current";
  const size = big ? 30 : 24;
  const tone =
    state === "done"
      ? "bg-vs-success-soft text-vs-success"
      : state === "current"
        ? "bg-vs-accent text-vs-on-accent ring-4 ring-vs-accent-soft"
        : state === "locked"
          ? "bg-vs-subtle text-vs-fg-3"
          : "border-2 border-vs-accent bg-vs-surface text-vs-accent";
  return (
    <span aria-hidden className={`${base} ${tone}`} style={{ width: size, height: size, top: NODE_CENTER_Y - size / 2, left: railX(index) - size / 2 }}>
      {state === "done" ? <Check size={14} strokeWidth={3} /> : state === "locked" ? <Lock size={12} strokeWidth={2.25} /> : <BookOpen size={big ? 16 : 13} strokeWidth={2.25} />}
    </span>
  );
}

function PathChapterItem({
  chapter,
  state,
  index,
  isLast,
  open,
  onToggle,
  currentStepId,
}: {
  chapter: PathChapter;
  state: PathChapterState;
  index: number;
  isLast: boolean;
  open: boolean;
  onToggle: () => void;
  currentStepId: string | null;
}) {
  const t = useT();
  const x = railX(index);
  const nextX = railX(index + 1);
  const label = `${chapter.bookName} ${chapter.number}`;
  const panelId = `path-${chapter.id}`;
  const stepsDone = t("courseView.stepsDone", { done: chapter.completedLessons, total: chapter.lessonCount });
  const traveled = state === "done";

  return (
    <li
      data-path-chapter={chapter.id}
      data-chapter-state={state}
      data-path-current={state === "current" ? "" : undefined}
      className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)] gap-x-2 sm:gap-x-3"
    >
      <div className="relative" style={{ width: RAIL }} aria-hidden>
        <Node state={state} index={index} />
        {/* de slingerende route naar het volgende hoofdstuk */}
        {!isLast && (
          <svg
            className={`absolute overflow-visible ${traveled ? "text-vs-success" : "text-vs-line-strong"}`}
            style={{ left: 0, top: NODE_CENTER_Y, width: RAIL, height: "100%" }}
            viewBox={`0 0 ${RAIL} 100`}
            preserveAspectRatio="none"
            focusable="false"
          >
            <path
              d={`M ${x} 0 C ${x} 50, ${nextX} 50, ${nextX} 100`}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={traveled ? undefined : "2 7"}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>

      <div className="min-w-0 pb-3">
        {state === "current" ? (
          <CurrentCard chapter={chapter} label={label} stepsDone={stepsDone} currentStepId={currentStepId} />
        ) : state === "locked" ? (
          <div aria-disabled="true" className={`${surfaceCard} flex min-h-14 items-center gap-3 border-dashed p-3 text-vs-fg-3`}>
            <span className="min-w-0 flex-1">
              <span className="vs-wrap block font-extrabold text-vs-fg-2">{label}</span>
              <span className="block text-xs">{stepsDone}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold">
              <Lock size={14} aria-hidden />
              {t("courseView.path.chapterLocked")}
            </span>
          </div>
        ) : (
          <div className={surfaceCard}>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={panelId}
              className={`flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left ${focusRing}`}
            >
              <span className="min-w-0 flex-1">
                <span className="vs-wrap block font-extrabold text-vs-fg">{label}</span>
                <span className="block text-xs text-vs-fg-3">{stepsDone}</span>
              </span>
              {state === "done" && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-vs-success">
                  <Check size={14} strokeWidth={3} aria-hidden />
                  {t("courseView.path.chapterDone")}
                </span>
              )}
              <ChevronDown size={18} aria-hidden className={`vs-motion shrink-0 text-vs-fg-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div id={panelId} className="border-t border-vs-line p-[clamp(0.625rem,3vw,0.75rem)]">
                <StepGrid steps={chapter.steps} currentStepId={currentStepId} />
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function CurrentCard({
  chapter,
  label,
  stepsDone,
  currentStepId,
}: {
  chapter: PathChapter;
  label: string;
  stepsDone: string;
  currentStepId: string | null;
}) {
  const keys = chapterArtworkKeys(chapter.bookKey, chapter.number);
  const hasImage = artworkFor(keys) !== null;
  const percent = chapterPercent(chapter);
  return (
    <article className={`${surfaceCard} vs-rise overflow-hidden border-vs-accent/40 ring-1 ring-vs-accent/20`} aria-label={label}>
      {hasImage && (
        <MediaArtwork kind="reading" artworkKey={keys} ratio="21/9" sizes="(min-width: 1024px) 640px, 100vw" className="vs-decor" />
      )}
      <div className="flex flex-col gap-3 p-[clamp(0.625rem,3vw,1rem)]">
        <div className="flex flex-col gap-1">
          <h2 className="vs-wrap text-xl font-extrabold text-vs-fg">{label}</h2>
          <p className="text-sm font-semibold text-vs-fg-2">{stepsDone}</p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={chapter.lessonCount}
          aria-valuenow={chapter.completedLessons}
          aria-label={stepsDone}
          className="h-2 overflow-hidden rounded-full bg-vs-subtle"
        >
          <div className="vs-motion h-full rounded-full bg-vs-accent transition-all" style={{ width: `${percent}%` }} />
        </div>
        {(chapter.read !== "UNREAD" || chapter.exercisesAnswered > 0) && (
          <ContentStatusLine read={chapter.read} exercisesAnswered={chapter.exercisesAnswered} exercisesTotal={chapter.exercisesTotal} />
        )}
        <StepGrid steps={chapter.steps} currentStepId={currentStepId} />
      </div>
    </article>
  );
}

function StepGrid({ steps, currentStepId }: { steps: PathStep[]; currentStepId: string | null }) {
  return (
    <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2 p-0">
      {steps.map((step) => (
        <StepTile key={step.id} step={step} currentStepId={currentStepId} />
      ))}
    </ol>
  );
}

function StepTile({ step, currentStepId }: { step: PathStep; currentStepId: string | null }) {
  const t = useT();
  const state = stepState(step, currentStepId);
  const verses = t("courseView.path.verses", { from: step.startVerse, to: step.endVerse });
  const name = t("courseView.stepN", { n: step.number });

  if (state === "current") {
    return (
      <li className="col-span-full">
        <Link
          href={`/reading-lesson/${step.id}`}
          data-current-step
          className={`${primaryButton} !flex min-h-14 w-full !flex-wrap !justify-between !gap-2 !rounded-2xl !px-[clamp(0.625rem,3vw,1rem)] !py-2.5`}
        >
          <span className="min-w-0 flex-1 basis-28 !text-left">
            <span className="block text-xs font-bold opacity-90">{t("courseView.path.nextStep")}</span>
            <span className="vs-wrap block text-sm font-extrabold sm:text-base">
              {name} · {verses}
            </span>
          </span>
          <ArrowRight size={20} className="shrink-0" aria-hidden />
        </Link>
      </li>
    );
  }

  const body = (
    <>
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center rounded-full ${
          state === "done" ? "bg-vs-success-soft text-vs-success" : state === "locked" ? "bg-vs-subtle text-vs-fg-3" : "bg-vs-accent-soft text-vs-accent"
        }`}
        style={{ width: 24, height: 24 }}
      >
        {state === "done" ? <Check size={14} strokeWidth={3} /> : state === "locked" ? <Lock size={12} strokeWidth={2.25} /> : <BookOpen size={13} strokeWidth={2.25} />}
      </span>
      <span className="min-w-0">
        <span className="vs-wrap block text-sm font-extrabold sm:text-base">{name}</span>
        <span className="vs-wrap block text-xs text-vs-fg-3">{verses}</span>
        <span className="sr-only">{state === "done" ? t("courseView.path.stepDone") : state === "locked" ? t("courseView.path.stepLocked") : ""}</span>
      </span>
    </>
  );
  const tile = "flex min-h-12 flex-wrap items-center gap-2 rounded-xl border px-3 py-2";
  return (
    <li>
      {state === "locked" ? (
        <div aria-disabled="true" className={`${tile} border-dashed border-vs-line bg-vs-app text-vs-fg-3`}>
          {body}
        </div>
      ) : (
        <Link
          href={`/reading-lesson/${step.id}`}
          className={`${tile} border-vs-line bg-vs-surface text-vs-fg hover:bg-vs-subtle ${focusRing}`}
          title={state === "done" ? t("courseView.path.stepReread") : undefined}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
