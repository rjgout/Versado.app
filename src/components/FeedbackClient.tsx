"use client";

import { useEffect, useRef, useState } from "react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import type { MessageKey } from "@/lib/i18n/core";
import { getLanguage } from "@/lib/languages";
import { X } from "lucide-react";
import ProfilePage from "@/components/profile/ProfilePage";
import { ProfileCard, SettingsButton, SettingsStatus, settingsFieldClass } from "@/components/profile/settings";

const STATUSES = ["NEW", "IN_PROGRESS", "DONE", "WONT_DO"] as const;
const STATUS_CLASSES: Record<string, string> = {
  NEW: "bg-vs-subtle text-vs-fg-2",
  IN_PROGRESS: "bg-vs-warning-soft text-vs-warning",
  DONE: "bg-vs-accent-soft text-vs-accent",
  WONT_DO: "bg-vs-danger-soft text-vs-danger",
};

interface ReportView {
  id: string;
  message: string;
  screenshot: string | null;
  status: string;
  createdAt: string;
  kind?: "GENERAL" | "EXERCISE";
  questionId?: string | null;
  questionSource?: string | null;
  questionCategory?: string | null;
  verseRef?: string | null;
  questionSnapshot?: string | null;
}

const MAX_DIMENSION = 1400;
const JPEG_QUALITY = 0.8;

export default function FeedbackClient() {
  const t = useT();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/feedback");
    if (res.ok) setReports((await res.json()).reports);
  }

  useEffect(() => {
    load();
  }, []);

  function processFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        setScreenshot(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file) processFile(file);
  }

  async function submit() {
    if (!message.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), screenshot: screenshot ?? undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? t("feedback.sendFailed"));
      return;
    }
    setSuccessMsg(t("feedback.sent"));
    setMessage("");
    setScreenshot(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  }

  return (
    <ProfilePage title={t("pages.feedback")}>
      <ProfileCard
        description={t("feedback.intro")}
        actions={
          <SettingsButton variant="primary" disabled={submitting || !message.trim()} onClick={submit}>
            {submitting ? t("feedback.busy") : t("feedback.send")}
          </SettingsButton>
        }
      >
        <div className="flex flex-col gap-3" onPaste={onPaste}>
          <textarea
            className={`${settingsFieldClass} min-h-[7.5rem] resize-y`}
            aria-label={t("pages.feedback")}
            placeholder={t("feedback.placeholder")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <SettingsButton onClick={() => fileInputRef.current?.click()}>{t("feedback.addScreenshot")}</SettingsButton>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
            <span className="text-xs text-vs-fg-3">{t("feedback.orPaste")}</span>
          </div>
          {screenshot && (
            <div className="relative self-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshot} alt={t("feedback.screenshot")} className="max-h-40 rounded-lg border border-vs-line" />
              <button
                type="button"
                aria-label={t("season.remove")}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-vs-danger text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"
                onClick={() => setScreenshot(null)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
          {error && <SettingsStatus kind="error">{error}</SettingsStatus>}
          {successMsg && <SettingsStatus kind="success">{successMsg}</SettingsStatus>}
        </div>
      </ProfileCard>

      <ProfileCard title={t("feedback.yourReports")}>
        {!reports ? (
          <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-vs-fg-3">{t("feedback.none")}</p>
        ) : (
          <ul className="divide-y divide-vs-line">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {r.kind === "EXERCISE" && (
                      <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-vs-accent">
                        {t("feedback.exercise.label")} {r.verseRef ?? r.questionId ?? ""}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm text-vs-fg">{r.kind === "EXERCISE" && r.questionCategory ? t(`feedback.exercise.categories.${categoryKey(r.questionCategory)}` as MessageKey) : r.message}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold uppercase ${STATUS_CLASSES[r.status] ?? STATUS_CLASSES.NEW}`}>
                    {(STATUSES as readonly string[]).includes(r.status) ? t(`feedback.status.${r.status as (typeof STATUSES)[number]}`) : r.status}
                  </span>
                </div>
                {r.screenshot && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.screenshot} alt={t("feedback.screenshot")} className="max-h-32 self-start rounded-lg border border-vs-line" />
                )}
                <p className="text-xs text-vs-fg-3">
                  {new Date(r.createdAt).toLocaleDateString(intlLocale, { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ProfileCard>
    </ProfilePage>
  );
}

function categoryKey(code: string): string {
  const keys: Record<string, string> = {
    ANSWER_SHOULD_BE_ACCEPTED: "answerShouldBeAccepted",
    ANSWER_SHOULD_BE_REJECTED: "answerShouldBeRejected",
    QUESTION_UNCLEAR: "questionUnclear",
    ANSWERS_INCORRECT: "answersIncorrect",
    VISUAL_BROKEN: "visualBroken",
    OTHER: "other",
  };
  return keys[code] ?? "other";
}
