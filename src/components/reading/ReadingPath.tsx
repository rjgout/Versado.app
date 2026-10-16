"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, ChevronDown, Lock } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { ContentStatusLine } from "@/components/learning/ContentStatus";
import { artworkFor, chapterArtworkKeys } from "@/lib/artwork";
import { focusRing, primaryButton } from "@/components/versado/styles";
import { currentEntryKey } from "@/lib/navigationHistory";
import { requestScrollRestore } from "@/lib/scrollRestore";
import { chapterPercent, chapterState, pathScrollTarget, stepState, type PathChapter, type PathChapterState, type PathStep } from "@/lib/readingPath";

// Het leerpad van Stap voor stap: elk schriftuurlijk hoofdstuk is één omlijnde kaart in één kolom, in de volgorde van
// de cursus, met een kort recht streepje ertussen. Alleen presentatie: wat open, af of vergrendeld is komt uit de server
// (getStepOverview); een stap blijft lezen + vragen via de bestaande lesroute. Status staat binnen de kaart.

const card = "rounded-2xl border bg-vs-surface";

function cssPx(name: string): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/** Waar het venster moet staan om de actieve stap (en het hoofdstuk ervoor) te tonen; null zolang hij er niet is. */
function currentScrollTarget(): number | null {
  const current = document.querySelector<HTMLElement>("[data-path-current]");
  const step = current?.querySelector<HTMLElement>("[data-current-step]");
  if (!current || !step) return null;
  const doc = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  // het vorige hoofdstuk: de kaart vóór de huidige (het streepje ertussen is geen kaart)
  const previous = current.previousElementSibling?.previousElementSibling as HTMLElement | null | undefined;
  const stepTop = doc(step);
  return pathScrollTarget({
    previousTop: previous ? doc(previous) : null,
    cardTop: doc(current),
    stepTop,
    stepBottom: stepTop + step.getBoundingClientRect().height,
    header: cssPx("--header-offset"),
    nav: cssPx("--nav-height"),
    viewport: window.innerHeight,
  });
}

export default function ReadingPath({ chapters, currentStepId }: { chapters: PathChapter[]; currentStepId: string | null }) {
  const t = useT();
  // Wat de gebruiker zelf openklapte; het actieve hoofdstuk staat altijd open (ook na een nieuwe actieve stap).
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [away, setAway] = useState(false);
  const [settled, setSettled] = useState(false);

  // Bij het openen staat de actieve stap in beeld. Het scrollcoördinatiepunt (NavigationScroll) bepaalt of
  // dat mag: terug/vooruit herstelt de oude positie en wie al scrolde of tikte wordt nooit overschreven.
  useEffect(() => {
    if (!currentStepId) return;
    requestScrollRestore(currentEntryKey(), "position", currentScrollTarget);
  }, [currentStepId]);

  // "Mijn stap" pas na de eerste positionering, en alleen als de actieve stap buiten beeld is geraakt.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
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
      <ol aria-label={t("courseView.path.label")} data-reading-path className="m-0 flex list-none flex-col items-stretch p-0">
        {chapters.map((chapter, index) => (
          <PathChapterItem
            key={chapter.id}
            chapter={chapter}
            state={states[index]}
            isLast={index === chapters.length - 1}
            open={opened.has(chapter.id)}
            onToggle={() => toggle(chapter.id)}
            currentStepId={currentStepId}
          />
        ))}
      </ol>
      {settled && away && (
        <button
          type="button"
          onClick={goToMyStep}
          aria-label={t("courseView.path.myStepAria")}
          data-my-step
          className={`${primaryButton} vs-rise fixed right-3 z-20 !min-h-9 !px-3 !py-1 !text-xs shadow-md bottom-[calc(var(--nav-height,0px)+var(--vs-safe-area-bottom,0px)+0.75rem)]`}
        >
          <ArrowUp size={14} className="shrink-0" aria-hidden />
          {t("courseView.path.myStep")}
        </button>
      )}
    </div>
  );
}

function PathChapterItem({
  chapter,
  state,
  isLast,
  open,
  onToggle,
  currentStepId,
}: {
  chapter: PathChapter;
  state: PathChapterState;
  isLast: boolean;
  open: boolean;
  onToggle: () => void;
  currentStepId: string | null;
}) {
  const t = useT();
  const label = `${chapter.bookName} ${chapter.number}`;
  const panelId = `path-${chapter.id}`;
  const stepsDone = t("courseView.stepsDone", { done: chapter.completedLessons, total: chapter.lessonCount });

  return (
    <>
      <li data-path-chapter={chapter.id} data-chapter-state={state} data-path-current={state === "current" ? "" : undefined} className="min-w-0">
        {state === "current" ? (
          <CurrentCard chapter={chapter} label={label} stepsDone={stepsDone} currentStepId={currentStepId} />
        ) : state === "locked" ? (
          // niet interactief zolang de serverregels het hoofdstuk vergrendeld houden
          <div aria-disabled="true" className={`${card} flex min-h-12 items-center gap-3 border-vs-line bg-vs-subtle/60 px-3 py-2`}>
            <Heading label={label} stepsDone={stepsDone} muted />
            <span className="shrink-0 text-vs-fg-3">
              <Lock size={16} strokeWidth={2.25} aria-hidden />
              <span className="sr-only">{t("courseView.path.chapterLocked")}</span>
            </span>
          </div>
        ) : (
          <div className={`${card} border-vs-line`}>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={panelId}
              className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${focusRing}`}
            >
              <Heading label={label} stepsDone={stepsDone} />
              {state === "done" && (
                <span className="shrink-0 text-vs-success">
                  <Check size={18} strokeWidth={3} aria-hidden />
                  <span className="sr-only">{t("courseView.path.chapterDone")}</span>
                </span>
              )}
              <ChevronDown size={16} aria-hidden className={`vs-motion shrink-0 text-vs-fg-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div id={panelId} className="border-t border-vs-line p-[clamp(0.5rem,3vw,0.75rem)]">
                <StepGrid steps={chapter.steps} currentStepId={currentStepId} />
              </div>
            )}
          </div>
        )}
      </li>
      {/* kort, recht verbindingsstreepje: puur decoratief, de status staat in de kaart */}
      {!isLast && <li aria-hidden className="mx-auto h-[18px] w-[2px] shrink-0 list-none rounded-full bg-vs-line-strong" />}
    </>
  );
}

function Heading({ label, stepsDone, muted = false }: { label: string; stepsDone: string; muted?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={`vs-wrap block text-base font-extrabold leading-snug ${muted ? "text-vs-fg-2" : "text-vs-fg"}`}>{label}</span>
      <span className="block text-xs text-vs-fg-3">{stepsDone}</span>
    </span>
  );
}

function CurrentCard({ chapter, label, stepsDone, currentStepId }: { chapter: PathChapter; label: string; stepsDone: string; currentStepId: string | null }) {
  const keys = chapterArtworkKeys(chapter.bookKey, chapter.number);
  const hasImage = artworkFor(keys) !== null;
  const percent = chapterPercent(chapter);
  return (
    <article className={`${card} vs-rise overflow-hidden border-vs-accent/60 bg-vs-accent-soft/40 ring-1 ring-vs-accent/20`} aria-label={label}>
      {hasImage && (
        // decoratieve banner met vaste px-hoogte: het beeld groeit niet mee met de tekst en verdringt de stap niet
        <MediaArtwork kind="reading" artworkKey={keys} ratio="21/9" sizes="(min-width: 1024px) 640px, 100vw" className="vs-decor !aspect-auto h-[84px] sm:h-[104px]" />
      )}
      <div className="flex flex-col gap-2 p-[clamp(0.5rem,3vw,0.75rem)]">
        <div className="flex flex-col gap-0.5">
          <h2 className="vs-wrap text-lg font-extrabold leading-snug text-vs-fg">{label}</h2>
          <p className="text-xs font-semibold text-vs-fg-2">{stepsDone}</p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={chapter.lessonCount}
          aria-valuenow={chapter.completedLessons}
          aria-label={stepsDone}
          className="h-1.5 overflow-hidden rounded-full bg-vs-subtle"
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
  // twee kolommen op een gewone telefoon; bij 200% tekst of 320 px schakelt het vanzelf naar één kolom
  return (
    <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-2 p-0">
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

  const body = (
    <>
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
          state === "done"
            ? "bg-vs-success-soft text-vs-success"
            : state === "locked"
              ? "bg-vs-subtle text-vs-fg-3"
              : state === "current"
                ? "bg-vs-accent text-vs-on-accent"
                : "bg-vs-accent-soft text-vs-accent"
        }`}
        style={{ width: 22, height: 22 }}
      >
        {state === "done" ? <Check size={13} strokeWidth={3} /> : state === "locked" ? <Lock size={11} strokeWidth={2.25} /> : step.number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="vs-wrap block text-sm font-extrabold leading-tight">{name}</span>
        <span className="vs-wrap block text-xs leading-tight text-vs-fg-3">{verses}</span>
        {state === "current" && <span className="block text-xs font-bold leading-tight text-vs-accent">{t("courseView.path.nextStep")}</span>}
        {(state === "done" || state === "locked") && <span className="sr-only">{state === "done" ? t("courseView.path.stepDone") : t("courseView.path.stepLocked")}</span>}
      </span>
    </>
  );
  const tile = "flex min-h-11 items-center gap-2 rounded-xl border px-2.5 py-1.5";

  if (state === "locked") {
    return (
      <li>
        <div aria-disabled="true" className={`${tile} border-vs-line bg-vs-subtle/60 text-vs-fg-3`}>
          {body}
        </div>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={`/reading-lesson/${step.id}`}
        data-current-step={state === "current" ? "" : undefined}
        title={state === "done" ? t("courseView.path.stepReread") : undefined}
        className={`${tile} text-vs-fg ${focusRing} ${
          state === "current" ? "border-vs-accent bg-vs-surface ring-1 ring-vs-accent/40" : "border-vs-line bg-vs-surface hover:bg-vs-subtle"
        }`}
      >
        {body}
      </Link>
    </li>
  );
}
