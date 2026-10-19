"use client";
import Link from "next/link";
import { CheckCircle2, Circle, ChevronRight, PlayCircle } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import FocusLayout from "@/components/versado/FocusLayout";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import type { StudyReaderDTO } from "@/lib/studyContent/reader";
import { PERSONAL_STUDY_STEPS, type PersonalStudyView } from "@/lib/studyContent/personalStudy";
import type { StepProgressState } from "@/lib/studyContent/stepProgress";
import type { WeekContext } from "@/lib/studyContent/weekContext";
import { focusRing, primaryButton } from "@/components/versado/styles";
import { HeaderMenu, ModeSwitch, WeekNav, lessonBase, menuItem } from "./PersonalStudyParts";
import { useStudyMarkRead } from "./useStudyMarkRead";

/** Het weekoverzicht van Stap voor stap: precies zeven stappen, geen dagnamen en geen vergrendelingen. */
export default function StepOverview({
  data,
  view,
  progress,
  week,
  sessionKey,
}: {
  data: StudyReaderDTO;
  view: PersonalStudyView;
  progress: StepProgressState;
  week: WeekContext;
  sessionKey: string;
}) {
  const t = useT();
  const base = lessonBase(data.lesson.lessonId, data.lesson.collectionId);
  const query = useLiveQuery<{ revisionId: string; state: StepProgressState }>(
    ["studySteps", sessionKey, data.lesson.editionId, data.lesson.revisionId],
    () => fetchJson(`/api/study-steps?lessonEditionId=${encodeURIComponent(data.lesson.editionId)}`),
    { scopes: ["studySteps"], initialData: { revisionId: data.lesson.revisionId, state: progress }, staleTime: 30000 },
  );
  const state = query.data?.state ?? progress;
  const { readState, markingRead, readError, justMarkedRead, markRead } = useStudyMarkRead(data, sessionKey, () => false);
  const statusOf = (fingerprint: string) => state.steps.find((s) => s.fingerprint === fingerprint)?.status ?? "NOT_STARTED";
  // De laatst geopende stap als die nog niet klaar is, anders de eerste onafgeronde; nooit een vergrendeling.
  const lastOpened = view.steps.find((s) => s.index === state.lastOpenedIndex);
  const active =
    (lastOpened && statusOf(lastOpened.fingerprint) !== "COMPLETED" ? lastOpened : null) ??
    view.steps.find((s) => statusOf(s.fingerprint) !== "COMPLETED") ??
    null;
  return (
    <FocusLayout className="max-w-3xl">
      <div data-step-overview className="min-w-0 space-y-5 py-2">
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <ModeSwitch base={base} mode="steps" />
            <HeaderMenu>
              <Link href={`${base}?weergave=volledig`} prefetch={false} className={menuItem}>{t("cfmStudy.viewFull")}</Link>
            </HeaderMenu>
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-extrabold leading-tight text-vs-fg sm:text-2xl" lang={data.lesson.language}>
              {view.weekTitle ?? data.lesson.title}
            </h1>
            {view.scriptureTitle && <p className="text-sm text-vs-fg-2">{view.scriptureTitle}</p>}
          </div>
          <div>
            <div role="progressbar" aria-label={t("cfmStudy.stepsProgress", { done: state.completedCount, total: PERSONAL_STUDY_STEPS })} aria-valuemin={0} aria-valuemax={PERSONAL_STUDY_STEPS} aria-valuenow={state.completedCount} className="h-1.5 overflow-hidden rounded-full bg-vs-subtle">
              <div className="h-full bg-vs-accent" style={{ width: `${(state.completedCount / PERSONAL_STUDY_STEPS) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-sm text-vs-fg-2">{t("cfmStudy.stepsProgress", { done: state.completedCount, total: PERSONAL_STUDY_STEPS })}</p>
          </div>
        </header>
        <ol aria-label={t("cfmStudy.stepsList")} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {view.steps.map((step) => {
            const status = statusOf(step.fingerprint);
            const isActive = active?.index === step.index;
            const Icon = status === "COMPLETED" ? CheckCircle2 : status === "IN_PROGRESS" ? PlayCircle : Circle;
            return (
              <li key={step.fingerprint} className="min-w-0">
                <Link
                  href={`${base}/stappen/${step.index}`}
                  prefetch={false}
                  data-step={step.index}
                  data-step-status={status}
                  aria-current={isActive ? "step" : undefined}
                  className={`flex h-full min-h-24 min-w-0 flex-col gap-1.5 rounded-2xl border bg-vs-surface p-3.5 hover:bg-vs-subtle ${focusRing} ${isActive ? "border-vs-accent ring-1 ring-vs-accent" : "border-vs-line"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-vs-fg">{t("cfmStudy.stepN", { n: step.index })}</span>
                    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${status === "COMPLETED" ? "text-vs-success" : status === "IN_PROGRESS" ? "text-vs-accent" : "text-vs-fg-2"}`}>
                      <Icon aria-hidden className="h-4 w-4 shrink-0" />
                      {t(status === "COMPLETED" ? "cfmStudy.statusCompleted" : status === "IN_PROGRESS" ? "cfmStudy.statusInProgress" : "cfmStudy.statusNotStarted")}
                    </span>
                  </span>
                  <span className="min-w-0 break-words font-semibold leading-snug text-vs-fg [overflow-wrap:anywhere]">
                    {step.title}
                    {step.continued ? <span className="font-normal text-vs-fg-2"> · {t("cfmStudy.continued")}</span> : null}
                  </span>
                  {step.labels.length > 0 && <span className="break-words text-sm text-vs-fg-2">{step.labels.join(" · ")}</span>}
                  <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-bold text-vs-accent">
                    {t(status === "COMPLETED" ? "cfmStudy.stepReread" : isActive && status === "IN_PROGRESS" ? "cfmStudy.stepContinue" : "cfmStudy.stepOpen")}
                    <ChevronRight aria-hidden className="h-4 w-4" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
        <footer className="space-y-4 border-t border-vs-line pt-4">
          {state.allCompleted && (
            <div className="space-y-3 rounded-xl bg-vs-subtle/60 p-3">
              <p className="font-semibold">{t("cfmStudy.allDone")}</p>
              <p className="text-sm text-vs-fg-2">{t("cfmStudy.markInvite")}</p>
              {readState.read ? (
                <p data-study-read-status="read" role="status" className="flex items-center gap-2 font-semibold text-vs-success">
                  <CheckCircle2 aria-hidden className="h-5 w-5 shrink-0" />
                  {t("studyReader.readComplete")}
                </p>
              ) : (
                <div className="space-y-2">
                  <button type="button" data-mark-study-read className={`${primaryButton} min-h-12`} onClick={() => void markRead()} disabled={markingRead}>
                    <CheckCircle2 aria-hidden className="h-5 w-5 shrink-0" />
                    {markingRead ? t("studyReader.markingRead") : t("studyReader.markRead")}
                  </button>
                  {readError && <p role="status" className="text-sm text-vs-danger">{readError}</p>}
                </div>
              )}
              {justMarkedRead && <p role="status" className="text-sm font-semibold text-vs-success">{t("studyReader.readMarked")}</p>}
            </div>
          )}
          <WeekNav week={week} suffix="/stappen" />
        </footer>
      </div>
    </FocusLayout>
  );
}
