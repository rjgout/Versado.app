"use client";

import { useEffect, useState } from "react";
import FsyContentBlocks from "@/components/FsyContentBlocks";
import type { FsyContentBlock } from "@/lib/fsyContent";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import { FSY_CATEGORY_KEYS } from "@/components/FsyLessonView";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import AdminSection from "@/components/admin/AdminSection";
import { primaryButton, secondaryButton } from "@/components/versado/styles";

interface Lesson {
  id: string;
  year: number;
  month: number;
  category: string;
  title: string;
  content: string;
  images: string;
  sourceUrl: string;
  status: "DRAFT" | "PUBLISHED";
  publishedTitle: string | null;
  publishedAt: string | null;
  lastScrapedAt: string;
}

interface Data {
  settings: {
    autoPublish: boolean;
    lastCheckedAt: string | null;
    lastError: string | null;
  };
  lessons: Lesson[];
}

export default function AdminFsyClient() {
  const t = useT();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [savingSetting, setSavingSetting] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/admin/fsy");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t("adminFsy.statusFailed"));
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("adminFsy.statusFailed"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function setAutoPublish(autoPublish: boolean) {
    setSavingSetting(true);
    const res = await fetch("/api/admin/fsy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoPublish }),
    });
    const json = await res.json();
    setSavingSetting(false);
    if (!res.ok) {
      setError(json.error ?? t("adminFsy.settingFailed"));
      return;
    }
    setData((current) => (current ? { ...current, settings: json } : current));
  }

  async function publish(lessonId: string) {
    setPublishingId(lessonId);
    const res = await fetch(`/api/admin/fsy/${lessonId}/publish`, { method: "POST" });
    const json = await res.json().catch(() => null);
    setPublishingId(null);
    if (!res.ok) {
      setError(json?.error ?? t("adminFsy.publishFailed"));
      return;
    }
    await load();
  }

  if (!data) {
    return <section className="rounded-2xl border border-vs-line bg-vs-surface p-4 text-vs-fg-2">{t("adminFsy.loading")}</section>;
  }

  const drafts = data.lessons.filter((lesson) => lesson.status === "DRAFT");
  const published = data.lessons.filter((lesson) => lesson.publishedAt !== null);

  return (
    <AdminSection title={t("courseNames.fsy")}>
      <div>
        <p className="text-sm text-vs-fg-2">
          {t("adminFsy.intro")}
        </p>
      </div>

      <label className="flex items-center justify-between gap-4 rounded-xl border border-vs-line p-3">
        <span>
          <span className="block font-bold text-vs-fg">{t("adminFsy.autoPublish")}</span>
          <span className="block text-xs text-vs-fg-2">
            {t("adminFsy.autoPublishText")}
          </span>
        </span>
        <ToggleSwitch checked={data.settings.autoPublish} disabled={savingSetting} onChange={setAutoPublish} />
      </label>

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-vs-warning-soft px-3 py-1 font-bold">
          {t(drafts.length === 1 ? "adminFsy.draftsOne" : "adminFsy.draftsMany", { n: drafts.length })}
        </span>
        <span className="rounded-full bg-vs-accent-soft px-3 py-1 font-bold">
          {t("adminFsy.published", { n: published.length })}
        </span>
      </div>

      {data.settings.lastCheckedAt && (
        <p className="text-xs text-vs-fg-3">
          {t("adminFsy.lastCheck", { when: new Date(data.settings.lastCheckedAt).toLocaleString(intlLocale) })}
        </p>
      )}
      {data.settings.lastError && (
        <p className="text-sm font-semibold text-vs-danger">
          {t("adminFsy.lastError", { error: data.settings.lastError })}
        </p>
      )}
      {error && <p className="text-sm font-semibold text-vs-danger">{error}</p>}

      {drafts.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-extrabold text-vs-fg">{t("adminFsy.awaiting")}</h3>
          {drafts.map((lesson) => (
            <details key={lesson.id} className="rounded-xl border border-vs-line p-3">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-xs font-bold uppercase text-vs-fg-3">
                    {lesson.category in FSY_CATEGORY_KEYS
                      ? t(FSY_CATEGORY_KEYS[lesson.category as keyof typeof FSY_CATEGORY_KEYS])
                      : t("courseViews.fsy.lesson")} · {lesson.month}/{lesson.year}
                  </span>
                  <span className="block font-extrabold text-vs-fg">{lesson.title}</span>
                </span>
                <span className="shrink-0 text-vs-accent">{t("adminFsy.view")}</span>
              </summary>

              <div className="mt-4 flex flex-col gap-4">
                <FsyContentBlocks blocks={JSON.parse(lesson.content) as FsyContentBlock[]} />
                <div className="flex flex-wrap gap-3">
                  <button
                    className={primaryButton}
                    disabled={publishingId === lesson.id}
                    onClick={() => publish(lesson.id)}
                  >
                    {publishingId === lesson.id ? t("adminCommon.busy") : t("adminFsy.publish")}
                  </button>
                  <a href={lesson.sourceUrl} target="_blank" rel="noreferrer" className={secondaryButton}>
                    {t("adminFsy.openSource")}
                  </a>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}

      {drafts.length === 0 && <p className="text-sm text-vs-fg-2">{t("adminFsy.noDrafts")}</p>}
    </AdminSection>
  );
}
