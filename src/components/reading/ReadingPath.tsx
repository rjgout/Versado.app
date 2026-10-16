"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, ChevronDown, Lock } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { artworkFor, chapterArtworkKeys } from "@/lib/artwork";
import { focusRing, primaryButton } from "@/components/versado/styles";
import { currentEntryKey } from "@/lib/navigationHistory";
import { requestScrollRestore } from "@/lib/scrollRestore";
import { chapterPercent, chapterState, myStepDirection, pathScrollTarget, type MyStepDirection, stepState, type PathChapter, type PathChapterState, type PathStep } from "@/lib/readingPath";

// Het leerpad van Stap voor stap: elk schriftuurlijk hoofdstuk is één omlijnde kaart in één kolom, in de volgorde van
// de cursus, met een kort recht streepje ertussen. Alleen presentatie: wat open, af of vergrendeld is komt uit de server
// (getStepOverview); een stap blijft lezen + vragen via de bestaande lesroute. Status staat binnen de kaart.

const card = "rounded-2xl border bg-vs-surface";
// Breedte van de overlopende miniatuur links; de tekst begint pas waar het beeld al grotendeels is weggefaded.
const THUMB_PAD = "pl-[96px]";

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
  const [direction, setDirection] = useState<MyStepDirection | null>(null);
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
    // Het zichtbare gebied is het scherm tussen de vaste balken; de richting volgt uit de werkelijke plek van de stap.
    const header = cssPx("--header-offset");
    const nav = cssPx("--nav-height");
    const observer = new IntersectionObserver(
      ([entry]) => {
        const r = entry.boundingClientRect;
        setDirection(entry.isIntersecting ? null : myStepDirection({ top: r.top, bottom: r.bottom, header, nav, viewport: window.innerHeight }));
      },
      { threshold: 0, rootMargin: `-${Math.round(header)}px 0px -${Math.round(nav)}px 0px` },
    );
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
            nextState={index < chapters.length - 1 ? states[index + 1] : null}
            open={opened.has(chapter.id)}
            onToggle={() => toggle(chapter.id)}
            currentStepId={currentStepId}
          />
        ))}
      </ol>
      {settled && direction && (
        <button
          type="button"
          onClick={goToMyStep}
          aria-label={t("courseView.path.myStepAria")}
          data-my-step
          data-direction={direction}
          className={`${primaryButton} vs-rise fixed right-3 z-20 !min-h-8 !gap-1 !px-2.5 !py-1 !text-xs shadow-md bottom-[calc(var(--nav-height,0px)+var(--vs-safe-area-bottom,0px)+0.75rem)]`}
        >
          {direction === "down" ? <ArrowDown size={14} className="shrink-0" aria-hidden /> : <ArrowUp size={14} className="shrink-0" aria-hidden />}
          {t("courseView.path.myStep")}
        </button>
      )}
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
  const thumb = artworkFor(artworkKeys) !== null;

  return (
    <>
      <li data-path-chapter={chapter.id} data-chapter-state={state} data-path-current={state === "current" ? "" : undefined} className="min-w-0">
        {state === "current" ? (
          <CurrentCard chapter={chapter} label={label} stepsDone={stepsDone} currentStepId={currentStepId} />
        ) : state === "locked" ? (
          // niet interactief zolang de serverregels het hoofdstuk vergrendeld houden
          <div aria-disabled="true" className={`${card} relative flex min-h-12 items-center gap-3 border-vs-line !bg-vs-subtle px-3 py-2 ${thumb ? THUMB_PAD : ""}`}>
            {thumb && <ChapterThumb artworkKeys={artworkKeys} fadeTo="to-vs-subtle" dimmed />}
            <Heading label={label} stepsDone={stepsDone} muted />
            <span className="relative shrink-0 text-vs-fg-2">
              <Lock size={18} strokeWidth={2.25} aria-hidden />
              <span className="sr-only">{t("courseView.path.chapterLocked")}</span>
            </span>
          </div>
        ) : (
          <div className={`${card} border-vs-line`}>
            <div className="relative">
              {thumb && <ChapterThumb artworkKeys={artworkKeys} fadeTo="to-vs-surface" />}
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={panelId}
                className={`relative flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${thumb ? THUMB_PAD : ""} ${focusRing}`}
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

/**
 * Kleine illustratie links op een compacte kaart die horizontaal in de kaartachtergrond overloopt. Alleen het
 * bestaande register (chapterArtworkKeys); zonder beeld rendert de aanroeper deze laag niet. Decoratief en lui
 * geladen op het formaat van de miniatuur, zodat honderden hoofdstukken geen honderden grote beelden ophalen.
 */
function ChapterThumb({ artworkKeys, fadeTo, dimmed = false }: { artworkKeys: string[]; fadeTo: string; dimmed?: boolean }) {
  return (
    <div aria-hidden data-chapter-thumb className="pointer-events-none absolute inset-y-0 left-0 w-[120px] overflow-hidden rounded-l-2xl">
      <MediaArtwork
        kind="reading"
        artworkKey={artworkKeys}
        ratio="1/1"
        sizes="120px"
        className={`vs-decor !absolute inset-0 !aspect-auto h-full w-full ${dimmed ? "opacity-45 saturate-50" : "opacity-90"}`}
      />
      <div className={`absolute inset-0 bg-gradient-to-r from-transparent ${dimmed ? "via-vs-subtle/50" : "via-vs-surface/50"} ${fadeTo}`} />
    </div>
  );
}

/** Kleur van het verbindingsstuk per overgang: voltooid is gedempt accent, de overgang naar het huidige hoofdstuk krijgt het volle accent, toekomstig is neutraal. */
function connectorTone(from: PathChapterState, to: PathChapterState): { line: string; top: string; bottom: string } {
  if (to === "current") return { line: "from-vs-accent/30 to-vs-accent", top: "bg-vs-accent/40", bottom: "bg-vs-accent" };
  if (from === "current") return { line: "from-vs-accent to-vs-line-strong", top: "bg-vs-accent", bottom: "bg-vs-line-strong" };
  if (to === "locked") return { line: "from-vs-line-strong to-vs-line-strong/60", top: "bg-vs-line-strong", bottom: "bg-vs-line-strong/60" };
  return { line: "from-vs-accent/40 to-vs-accent/40", top: "bg-vs-accent/40", bottom: "bg-vs-accent/40" };
}

// 18 px hoog, zoals het eenvoudige streepje: de kleine punten aan de uiteinden raken de kaarten, de lijn ertussen loopt zacht over.
function Connector({ from, to }: { from: PathChapterState; to: PathChapterState }) {
  const tone = connectorTone(from, to);
  return (
    <li aria-hidden data-connector className="pointer-events-none mx-auto flex h-[18px] w-[6px] shrink-0 list-none flex-col items-center">
      <span className={`h-1 w-1 shrink-0 rounded-full ${tone.top}`} />
      <span className={`w-[2px] flex-1 bg-gradient-to-b ${tone.line}`} />
      <span className={`h-1 w-1 shrink-0 rounded-full ${tone.bottom}`} />
    </li>
  );
}

function Heading({ label, stepsDone, muted = false }: { label: string; stepsDone: string; muted?: boolean }) {
  return (
    <span className="relative min-w-0 flex-1">
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
    // Dubbele omlijning: een verloopkader van 2 px (accent, met een klein warm lichtaccent in de hoek) rond de hele kaart,
    // beeldhoeken inbegrepen, plus een zachte gloed. Alleen semantische tokens, dus ook in donkere modus goed.
    <div className="vs-rise rounded-[1.125rem] bg-gradient-to-br from-vs-accent via-vs-accent to-vs-xp-fill p-[2px] shadow-lg shadow-vs-accent/25 ring-[3px] ring-vs-accent/15">
      <article className="overflow-hidden rounded-2xl bg-vs-surface" aria-label={label}>
        {/* Titel en voortgang staan op de illustratie. De kop heeft een eigen donkere basis en gradient, dus de tekst blijft
            leesbaar terwijl het beeld laadt, ontbreekt of licht is. Zonder beeld valt de kop terug op een lichte accentkleur. */}
        <div className={`relative flex min-h-[9.5rem] flex-col justify-end sm:min-h-[11rem] ${hasImage ? "bg-vs-overlay" : "bg-vs-accent-soft"}`}>
          {hasImage && (
            <>
              <MediaArtwork kind="reading" artworkKey={keys} ratio="21/9" sizes="(min-width: 1024px) 640px, 100vw" className="vs-decor !absolute inset-0 !aspect-auto h-full w-full" />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-vs-overlay/90 via-vs-overlay/50 to-transparent" />
            </>
          )}
          <div className="relative flex flex-col gap-1.5 px-[clamp(0.5rem,3vw,0.75rem)] pb-[clamp(0.5rem,3vw,0.75rem)] pt-10">
            <h2 className={`vs-wrap text-xl font-extrabold leading-snug ${hasImage ? "text-white" : "text-vs-fg"}`}>{label}</h2>
            <p className={`text-xs font-semibold ${hasImage ? "text-white/90" : "text-vs-accent"}`}>{stepsDone}</p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={chapter.lessonCount}
              aria-valuenow={chapter.completedLessons}
              aria-label={stepsDone}
              className={`h-1.5 overflow-hidden rounded-full ${hasImage ? "bg-white/30" : "bg-vs-accent/15"}`}
            >
              <div className="vs-motion h-full rounded-full bg-vs-accent transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-b from-vs-accent-soft/60 to-vs-surface p-[clamp(0.5rem,3vw,0.75rem)]">
          <StepGrid steps={chapter.steps} currentStepId={currentStepId} />
        </div>
      </article>
    </div>
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
