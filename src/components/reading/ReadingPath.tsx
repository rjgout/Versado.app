"use client";

import { useMemo, useState } from "react";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { Check, ChevronDown, Lock } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MyStepNav from "@/components/reading/MyStepNav";
import { ActiveChapterCard, CARD, ChapterThumb, Connector, DoneMark, Heading, LockedChapterCard, THUMB_PAD, hasArtwork } from "@/components/reading/pathParts";
import { chapterArtworkKeys } from "@/lib/artwork";
import { focusRing } from "@/components/versado/styles";
import { chapterPercent, chapterState, stepState, type PathChapter, type PathChapterState, type PathStep } from "@/lib/readingPath";

// Het leerpad van Stap voor stap: elk schriftuurlijk hoofdstuk is één omlijnde kaart in één kolom, in de volgorde van
// de cursus, met een kort recht verbindingsstuk ertussen. Alleen presentatie: wat open, af of vergrendeld is komt uit de
// server (getStepOverview); een stap blijft lezen + vragen via de bestaande lesroute. Status staat binnen de kaart.
// De gedeelde bouwstenen (kaarten, miniaturen, verbindingen, "Naar mijn stap") staan in pathParts.tsx en MyStepNav.tsx.

export default function ReadingPath({ chapters, currentStepId }: { chapters: PathChapter[]; currentStepId: string | null }) {
  const t = useT();
  // Wat de gebruiker zelf openklapte; het actieve hoofdstuk staat altijd open (ook na een nieuwe actieve stap).
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(id: string) {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
            nextState={index < chapters.length - 1 ? states[index + 1] : null}
            open={opened.has(chapter.id)}
            onToggle={() => toggle(chapter.id)}
            currentStepId={currentStepId}
          />
        ))}
      </ol>
      <MyStepNav currentKey={currentStepId} kind="step" />
    </div>
  );
}

function PathChapterItem({
  chapter,
  state,
  nextState,
  open,
  onToggle,
  currentStepId,
}: {
  chapter: PathChapter;
  state: PathChapterState;
  nextState: PathChapterState | null;
  open: boolean;
  onToggle: () => void;
  currentStepId: string | null;
}) {
  const t = useT();
  const label = `${chapter.bookName} ${chapter.number}`;
  const panelId = `path-${chapter.id}`;
  const stepsDone = t("courseView.stepsDone", { done: chapter.completedLessons, total: chapter.lessonCount });
  const artworkKeys = chapterArtworkKeys(chapter.bookKey, chapter.number);
  const thumb = hasArtwork(artworkKeys);

  return (
    <>
      <li data-path-chapter={chapter.id} data-chapter-state={state} data-path-current={state === "current" ? "" : undefined} className="min-w-0">
        {state === "current" ? (
          <ActiveChapterCard
            label={label}
            subtitle={stepsDone}
            artworkKeys={artworkKeys}
            progress={{ now: chapter.completedLessons, max: chapter.lessonCount, percent: chapterPercent(chapter) }}
          >
            <StepGrid steps={chapter.steps} currentStepId={currentStepId} />
          </ActiveChapterCard>
        ) : state === "locked" ? (
          // niet interactief zolang de serverregels het hoofdstuk vergrendeld houden
          <LockedChapterCard label={label} subtitle={stepsDone} artworkKeys={artworkKeys} />
        ) : (
          <div className={`${CARD} border-vs-line`}>
            <div className="relative">
              {thumb && <ChapterThumb artworkKeys={artworkKeys} fadeTo="to-vs-surface" />}
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={panelId}
                className={`relative flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${thumb ? THUMB_PAD : ""} ${focusRing}`}
              >
                <Heading label={label} subtitle={stepsDone} />
                {state === "done" && <DoneMark />}
                <ChevronDown size={16} aria-hidden className={`vs-motion shrink-0 text-vs-fg-3 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            </div>
            {open && (
              <div id={panelId} className="border-t border-vs-line p-[clamp(0.5rem,3vw,0.75rem)]">
                <StepGrid steps={chapter.steps} currentStepId={currentStepId} />
              </div>
            )}
          </div>
        )}
      </li>
      {/* kort, recht verbindingsstuk: puur decoratief, de status staat in de kaart */}
      {nextState && <Connector from={state} to={nextState} />}
    </>
  );
}

function StepGrid({ steps, currentStepId }: { steps: PathStep[]; currentStepId: string | null }) {
  // twee kolommen op een gewone telefoon; bij 200% tekst of 320 px schakelt het vanzelf naar één kolom
  return (
    <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,7rem),1fr))] gap-1.5 p-0">
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
        style={{ width: 20, height: 20 }}
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
  const tile = "flex h-full min-h-11 w-full items-center gap-1.5 rounded-xl border px-2 py-1";

  if (state === "locked") {
    return (
      <li className="flex">
        <div aria-disabled="true" className={`${tile} border-vs-line bg-vs-subtle/60 text-vs-fg-3`}>
          {body}
        </div>
      </li>
    );
  }
  return (
    <li className="flex">
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
