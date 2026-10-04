"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { EXERCISE_FEEDBACK_OPTIONS, type ExerciseFeedbackCategory, type ExerciseFeedbackContext } from "@/lib/exerciseFeedback";

export default function ExerciseFeedbackSheet({
  context,
  onClose,
  onSubmitted,
}: {
  context: ExerciseFeedbackContext;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const t = useT();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(category: ExerciseFeedbackCategory) {
    if (submitting) return;
    setSubmitting(true);
    const requestId = crypto.randomUUID();
    try {
      const res = await fetch("/api/feedback/exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...context, category, requestId }),
      });
      if (res.ok) onSubmitted();
      else setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-feedback-title"
        className="w-full max-w-lg rounded-t-3xl bg-vs-elevated p-5 pb-[calc(1.25rem+var(--vs-safe-area-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="exercise-feedback-title" className="text-lg font-extrabold text-vs-fg">{t("feedback.exercise.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex h-10 w-10 items-center justify-center rounded-full text-vs-fg-2 hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {EXERCISE_FEEDBACK_OPTIONS.map((option) => (
            <button
              key={option.code}
              type="button"
              className="min-h-12 rounded-2xl border border-vs-line bg-vs-surface px-4 py-3 text-left text-sm font-bold text-vs-fg transition hover:border-vs-accent hover:bg-vs-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent active:scale-[0.99]"
              onClick={() => submit(option.code)}
              disabled={submitting}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
