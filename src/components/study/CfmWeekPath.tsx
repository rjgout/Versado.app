"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Circle, PlayCircle } from "lucide-react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { ActiveChapterCard, CARD, ChapterThumb, Connector, DoneMark, Heading, THUMB_PAD, type VisualState } from "@/components/reading/pathParts";
import { focusRing, primaryButton } from "@/components/versado/styles";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { rememberMode } from "@/lib/studyContent/personalStudyModeClient";
import { modeParam, type PersonalStudyModeValue } from "@/lib/studyContent/personalStudyMode";
import type { StepProgressState } from "@/lib/studyContent/stepProgress";
import { formatWeekPeriod, lessonBase } from "./PersonalStudyParts";

// Het weekpad van de persoonlijke studie: dezelfde leerlijn als de Boek van Mormon-leescursussen (grote actieve kaart,
// compacte inklapbare kaarten, verbindingsstukjes), maar zonder vergrendelingen. Elke beschikbare week en elke stap is direct
// te openen. Vrije studie toont geen stappen; Stap voor stap toont de zeven stappen onder de actieve of uitgeklapte week.
// Alleen presentatie; de bouwstenen komen uit components/reading/pathParts.tsx.

export interface WeekRow {
  id: string;
  lessonId: string;
  collectionId: string;
  lessonKey: string;
  title: string;
  startsOn: string | null;
  endsOnExclusive: string | null;
  read: boolean;
  stepsDone: number;
  imageMediaId: string | null;
}
interface StepPlanRow { index: number; title: string | null; continued: boolean; labels: string[]; fingerprint: string }
interface StepPlanResponse { revisionId: string; state: StepProgressState; steps: StepPlanRow[] }

const mediaSrc = (id: string | null) => (id ? `/api/study-media/${encodeURIComponent(id)}` : null);

/** Keuze tussen Vrije studie en Stap voor stap; de keuze wordt bewaard (server-side) en een gewone link blijft werken zonder script. */
export function PathModeSwitch({ mode }: { mode: PersonalStudyModeValue }) {
  const t = useT();
  const items = [
    { key: "FREE" as const, label: t("cfmStudy.modeFree") },
    { key: "STEPS" as const, label: t("cfmStudy.modeSteps") },
  ];
  return (
    <nav aria-label={t("cfmStudy.modeLabel")} className="inline-flex min-w-0 max-w-full rounded-full border border-vs-line-strong bg-vs-surface p-0.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={`/courses?weergave=${modeParam(item.key)}`}
          prefetch={false}
          aria-current={mode === item.key ? "page" : undefined}
          onClick={() => void rememberMode(item.key)}
          className={`inline-flex min-h-9 items-center justify-center rounded-full px-3 text-center text-sm font-bold ${focusRing} ${mode === item.key ? "bg-vs-accent text-vs-on-accent" : "text-vs-fg-2 hover:bg-vs-subtle"}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function WeekSteps({ week, sessionKey }: { week: WeekRow; sessionKey: string }) {
  const t = useT();
  const base = lessonBase(week.lessonId, week.collectionId);
  const query = useLiveQuery<StepPlanResponse>(
    ["studySteps", "plan", sessionKey, week.id],
    () => fetchJson(`/api/study-steps?lessonEditionId=${encodeURIComponent(week.id)}`),
    { scopes: ["studySteps"], staleTime: 30000 },
  );
  if (query.error && !query.data) return <p role="status" className="text-sm text-vs-fg-2">{t("cfmStudy.stepsFailed")}</p>;
  if (!query.data) return <p role="status" className="text-sm text-vs-fg-2">{t("cfmStudy.stepsLoading")}</p>;
  const { state, steps } = query.data;
  const statusOf = (fingerprint: string) => state.steps.find((s) => s.fingerprint === fingerprint)?.status ?? "NOT_STARTED";
  const lastOpened = steps.find((s) => s.index === state.lastOpenedIndex);
  const active = (lastOpened && statusOf(lastOpened.fingerprint) !== "COMPLETED" ? lastOpened : null) ?? steps.find((s) => statusOf(s.fingerprint) !== "COMPLETED") ?? null;
  return (
    <div className="space-y-2">
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-1.5 p-0">
        {steps.map((step) => {
          const status = statusOf(step.fingerprint);
          const isActive = active?.index === step.index;
          return (
            <li key={step.fingerprint} className="flex">
              <Link
                href={`${base}/stappen/${step.index}`}
                prefetch={false}
                data-week-step={step.index}
                data-step-status={status}
                aria-current={isActive ? "step" : undefined}
                className={`flex h-full min-h-11 w-full items-center gap-1.5 rounded-xl border px-2 py-1 text-vs-fg ${focusRing} ${isActive ? "border-vs-accent bg-vs-surface ring-1 ring-vs-accent/40" : "border-vs-line bg-vs-surface hover:bg-vs-subtle"}`}
              >
                <span
                  aria-hidden
                  className={`flex shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${status === "COMPLETED" ? "bg-vs-success-soft text-vs-success" : isActive ? "bg-vs-accent text-vs-on-accent" : "bg-vs-accent-soft text-vs-accent"}`}
                  style={{ width: 20, height: 20 }}
                >
                  {status === "COMPLETED" ? <Check size={13} strokeWidth={3} /> : status === "IN_PROGRESS" ? <PlayCircle size={13} /> : step.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="vs-wrap block text-sm font-extrabold leading-tight">{t("cfmStudy.stepN", { n: step.index })}</span>
                  <span className="vs-wrap block text-xs leading-tight text-vs-fg-3">
                    {step.title}
                    {step.continued ? ` · ${t("cfmStudy.continued")}` : ""}
                  </span>
                  <span className="sr-only">{t(status === "COMPLETED" ? "cfmStudy.statusCompleted" : status === "IN_PROGRESS" ? "cfmStudy.statusInProgress" : "cfmStudy.statusNotStarted")}</span>
                </span>
                {status === "NOT_STARTED" && <Circle aria-hidden size={14} className="shrink-0 text-vs-fg-3" />}
              </Link>
            </li>
          );
        })}
      </ol>
      <Link href={`${base}/stappen`} prefetch={false} className={`inline-flex min-h-11 items-center text-sm font-bold text-vs-accent underline-offset-2 hover:underline ${focusRing}`}>
        {t("cfmStudy.weekSteps")}
      </Link>
    </div>
  );
}

export default function CfmWeekPath({
  weeks,
  mode,
  activeWeekId,
  sessionKey,
  onOpenWeek,
}: {
  weeks: WeekRow[];
  mode: PersonalStudyModeValue;
  activeWeekId: string | null;
  sessionKey: string;
  /** Onthoudt de geopende week als actieve les (bestaande studiecontext); mag falen zonder de navigatie te raken. */
  onOpenWeek?: (lessonKey: string) => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  // Wat de gebruiker zelf uitklapte; de actieve week staat altijd open. Afgeronde weken zijn standaard ingeklapt maar blijven te openen.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpened((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stateOf = (week: WeekRow): VisualState =>
    week.id === activeWeekId ? "current" : week.read || week.stepsDone >= 7 ? "done" : week.stepsDone > 0 ? "started" : "open";
  const states = weeks.map(stateOf);
  return (
    <ol aria-label={t("cfmStudy.pathLabel")} data-cfm-week-path data-path-mode={mode} className="m-0 flex list-none flex-col items-stretch p-0">
      {weeks.map((week, index) => {
        const state = states[index];
        const period = formatWeekPeriod(week.startsOn, week.endsOnExclusive, language);
        const progress = mode === "STEPS" ? t("cfmStudy.weekProgress", { done: week.stepsDone, total: 7 }) : week.read ? t("cfmStudy.weekRead") : null;
        const subtitle = [period, progress].filter(Boolean).join(" · ");
        const imageSrc = mediaSrc(week.imageMediaId);
        const thumb = !!imageSrc;
        const href = lessonBase(week.lessonId, week.collectionId);
        const isOpen = opened.has(week.id);
        return (
          <Fragment key={week.id}>
          <li data-week={week.id} data-study-lesson={week.id} data-week-state={state} className="min-w-0">
            {state === "current" ? (
              <ActiveChapterCard
                label={week.title}
                subtitle={subtitle || t("cfmStudy.currentWeek")}
                artworkKeys={[]}
                imageSrc={imageSrc}
                progress={mode === "STEPS" ? { now: week.stepsDone, max: 7, percent: Math.round((week.stepsDone / 7) * 100) } : undefined}
              >
                {mode === "STEPS" ? (
                  <WeekSteps week={week} sessionKey={sessionKey} />
                ) : (
                  <Link href={href} prefetch={false} onClick={() => onOpenWeek?.(week.lessonKey)} className={`${primaryButton} min-h-12 w-full sm:w-auto`}>
                    {week.read ? t("cfmStudy.openWeek") : t("cfmStudy.continueWeek")}
                  </Link>
                )}
              </ActiveChapterCard>
            ) : mode === "FREE" ? (
              <div className={`${CARD} relative ${state === "started" ? "border-vs-accent/50" : "border-vs-line"}`} data-chapter-card-state={state}>
                {thumb && <ChapterThumb artworkKeys={[]} imageSrc={imageSrc} fadeTo="to-vs-surface" />}
                <Link href={href} prefetch={false} onClick={() => onOpenWeek?.(week.lessonKey)} className={`relative flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${thumb ? THUMB_PAD : ""} ${focusRing}`}>
                  <Heading label={week.title} subtitle={subtitle} />
                  {state === "done" && <DoneMark />}
                </Link>
              </div>
            ) : (
              <div className={`${CARD} border-vs-line`} data-chapter-card-state={state}>
                <div className="relative">
                  {thumb && <ChapterThumb artworkKeys={[]} imageSrc={imageSrc} fadeTo="to-vs-surface" />}
                  <button
                    type="button"
                    onClick={() => toggle(week.id)}
                    aria-expanded={isOpen}
                    aria-controls={`week-${week.id}`}
                    aria-label={`${week.title}: ${isOpen ? t("cfmStudy.collapseWeek") : t("cfmStudy.expandWeek")}`}
                    className={`relative flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${thumb ? THUMB_PAD : ""} ${focusRing}`}
                  >
                    <Heading label={week.title} subtitle={subtitle} />
                    {state === "done" && <DoneMark />}
                    <ChevronDown size={16} aria-hidden className={`vs-motion shrink-0 text-vs-fg-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                </div>
                {isOpen && (
                  <div id={`week-${week.id}`} onClickCapture={() => onOpenWeek?.(week.lessonKey)} className="border-t border-vs-line p-[clamp(0.5rem,3vw,0.75rem)]">
                    <WeekSteps week={week} sessionKey={sessionKey} />
                  </div>
                )}
              </div>
            )}
          </li>
          {/* Verbindingsstuk als eigen lijstitem, zoals in het leespad van de Boek van Mormon-cursussen. */}
          {index < weeks.length - 1 && <Connector from={state} to={states[index + 1]} />}
          </Fragment>
        );
      })}
    </ol>
  );
}
