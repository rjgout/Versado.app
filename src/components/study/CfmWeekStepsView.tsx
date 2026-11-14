"use client";
import { Check,Circle,PlayCircle } from "lucide-react";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import { lessonBase } from "@/lib/studyContent/presentation";
import { focusRing } from "@/components/versado/styles";
import type { WeekRow,StepPlanResponse } from "./CfmWeekPath";
export function WeekStepCards({week,data}: {week:WeekRow;data:StepPlanResponse}) {
  const t=useT(), base=lessonBase(week.lessonId,week.collectionId);
  const { state, steps } = data;
  const statusOf = (fingerprint: string) => state.steps.find((s) => s.fingerprint === fingerprint)?.status ?? "NOT_STARTED";
  const lastOpened = steps.find((s) => s.index === state.lastOpenedIndex);
  const active = (lastOpened && statusOf(lastOpened.fingerprint) !== "COMPLETED" ? lastOpened : null) ?? steps.find((s) => statusOf(s.fingerprint) !== "COMPLETED") ?? null;
  return (
    <div className="space-y-2">
      <ol className="m-0 grid list-none grid-cols-2 gap-1.5 p-0">
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
    </div>
  );
}
