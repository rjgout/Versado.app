"use client";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { ArrowRight, EyeOff } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import type { MessageKey } from "@/lib/i18n/core";
import { weekLabelKey } from "@/lib/studyContent/weekLabels";
import type { ResumeReason } from "@/lib/studyContent/weekSelection";
import { CardPicker, CardProgress, ContentCard, StatusChip, cardActions, type PickerItem } from "@/components/versado/ContentCard";
import VisualIdentityIcon from "@/components/versado/VisualIdentityIcon";
export interface CourseView {
  id: string;
  slug: string;
  type: "FRONT_TO_BACK" | "FREE_CHOICE" | "BY_BOOK" | "PODCAST" | "KIDS" | "INTRO" | "READING_LESSONS" | "FSY" | "STUDY_STEPS" | "STUDY_FREE";
  name: string;
  description: string | null;
  totalChapters: number;
  unitPlural?: string;
  completedCount: number;
  xpAvailable: number;
  isActive: boolean;
  currentChapter: { id: string; bookName: string; number: number } | null;
  resumeHref: string;
  /** Alleen CFM: waarom de hervatweek die week is (bepaalt het label op de kaart). */
  resumeReason?: ResumeReason | null;
  artwork: string[];
  /** Officieel lesbeeld van de huidige week (studiecursussen); anders het artworkregister. */
  imageSrc?: string | null;
}

export interface CatalogCourseView {
  id: string;
  slug: string;
  type: CourseView["type"];
  name: string;
  description: string | null;
  totalChapters: number;
  artwork: string[];
}

const TYPE_LABELS: Record<CourseView["type"], MessageKey> = {
  INTRO: "courses.types.intro",
  READING_LESSONS: "courses.types.readingLessons",
  FRONT_TO_BACK: "courses.types.frontToBack",
  FREE_CHOICE: "courses.types.freeChoice",
  BY_BOOK: "courses.types.byBook",
  PODCAST: "courses.types.podcast",
  KIDS: "courses.types.kids",
  FSY: "courses.types.fsy",
  STUDY_STEPS: "courses.types.studySteps",
  STUDY_FREE: "courses.types.studyFree",
};

const CARD_SIZES = "(min-width: 1024px) 320px, (min-width: 768px) 50vw, 100vw";

const isStudyType = (type: string) => type === "STUDY_STEPS" || type === "STUDY_FREE";

export default function CoursesView({ courses, catalog = null, failed = false, busy = false, addingId = null, hide, move, add, onCatalogOpen = () => {} }: {
 courses: CourseView[]; catalog?: CatalogCourseView[] | null; failed?: boolean; busy?: boolean; addingId?: string | null;
 hide?: (id: string) => void; move?: (from: number, to: number) => void; add?: (id: string) => void; onCatalogOpen?: () => void;
}) {
 const t = useT();
 const activeCourse = courses.find(course => course.isActive) ?? null;
 const others = courses.filter(course => !course.isActive);
  const progressText = (course: CourseView) =>
    t("courses.progress", { done: course.completedCount, total: course.totalChapters, unit: course.unitPlural ?? t("terms.chapter.plural") });

  function progressOf(course: CourseView) {
    return course.totalChapters > 0 ? <CardProgress done={course.completedCount} total={course.totalChapters} text={progressText(course)} /> : null;
  }

  function chipsOf(course: CourseView) {
    const complete = course.totalChapters > 0 && course.completedCount >= course.totalChapters;
    return complete ? <StatusChip tone="success">{t("courses.completed")}</StatusChip> : null;
  }

  const pickerItems: PickerItem[] | null =
    catalog?.map((course) => ({
      id: course.id,
      title: course.name,
      label: t(TYPE_LABELS[course.type]),
      description: course.description,
      artwork: { kind: "course", keys: course.artwork },
    })) ?? null;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5 sm:gap-6">
      <div data-kompas-target="learn-intro">
        <h1 tabIndex={-1} className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("pages.courses")}</h1>
        <p className="text-sm text-vs-fg-2">{t("courses.intro")}</p>
      </div>

      {failed && <p role="alert" className="text-sm text-vs-danger">{t("cards.saveFailed")}</p>}

      {activeCourse && (
        <section className="flex flex-col gap-3" aria-labelledby="current-journey">
          <h2 id="current-journey" className="text-lg font-extrabold text-brand-800 dark:text-brand-300 sm:text-xl">
            {t("courses.currentJourney")}
          </h2>
          <ContentCard
            wide
            priority
            title={activeCourse.name}
            href={`/courses/${activeCourse.id}`}
            artwork={{ kind: "course", keys: activeCourse.artwork, sizes: "(min-width: 1024px) 480px, 100vw", asset: activeCourse.imageSrc ? { src: activeCourse.imageSrc } : null }}
            label={t(TYPE_LABELS[activeCourse.type])}
            chips={chipsOf(activeCourse)}
            description={activeCourse.description}
            actions={hide ? [{ label: t("cards.hide"), icon: EyeOff, onSelect: () => hide(activeCourse.id), disabled: busy }] : undefined}
          >
            {activeCourse.currentChapter && (
              <p className="text-sm font-bold text-vs-fg">
                {t("courses.next", { chapter: `${activeCourse.currentChapter.bookName} ${activeCourse.currentChapter.number}` }).replace(/^ — /, "")}
              </p>
            )}
            {progressOf(activeCourse)}
            {isStudyType(activeCourse.type) && activeCourse.resumeReason && (
              <p className="text-sm font-bold text-vs-fg" data-cfm-resume-label>{t(weekLabelKey(activeCourse.resumeReason)!)}</p>
            )}
            {/* Hervatten bij de volgende stap; de afbeelding en titel openen
                het cursusoverzicht. */}
            <Link
              href={activeCourse.resumeHref}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl bg-vs-accent px-4 text-sm font-extrabold text-vs-on-accent transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vs-surface"
            >
              {isStudyType(activeCourse.type) && !activeCourse.resumeReason ? t("cfmToday.viewWeeks") : t("courses.continue").replace(/\s*→\s*$/, "")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </ContentCard>
        </section>
      )}

      {courses.length === 0 && <p className="text-sm text-vs-fg-2">{t("courses.allHidden")}</p>}
      {!activeCourse && courses.length > 0 && <p className="text-sm text-vs-fg-2">{t("courses.noActive")}</p>}

      {others.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="discover-courses">
          <h2 id="discover-courses" className="text-lg font-extrabold text-brand-800 dark:text-brand-300 sm:text-xl">
            {t("courses.discoverMore")}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {others.map((course, index) => (
              <ContentCard
                key={course.id}
                title={course.name}
                href={`/courses/${course.id}`}
                artwork={{ kind: "course", keys: course.artwork, sizes: CARD_SIZES, asset: course.imageSrc ? { src: course.imageSrc } : null }}
                label={t(TYPE_LABELS[course.type])}
                chips={chipsOf(course)}
                description={course.description}
                priority={!activeCourse && index === 0}
                actions={hide && move ? cardActions({ t, index, count: others.length, busy, onMove: move, onHide: () => hide(course.id) }) : undefined}
              >
                {progressOf(course)}
              </ContentCard>
            ))}
          </div>
        </section>
      )}

      {add && <div data-kompas-target="learn-add">
      <CardPicker
        addLabel={t("courses.addCourse")}
        addHint={t("courses.addCourseHint")}
        emptyText={t("courses.allAdded")}
        items={pickerItems}
        busyId={addingId}
        disabled={busy}
        onOpen={onCatalogOpen}
        onAdd={add}
      />
      </div>}

      {!add && catalog && catalog.length > 0 && <section className="flex flex-col gap-3"><h2 className="text-lg font-extrabold">{t("courses.addCourse")}</h2><div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{catalog.map(course => <ContentCard key={course.id} title={course.name} href={`/courses/${course.id}`} artwork={{kind:"course",keys:course.artwork,sizes:CARD_SIZES}} label={t(TYPE_LABELS[course.type])} description={course.description}/>)}</div></section>}
      <Link href="/tools" className="card !py-3 flex items-center justify-between gap-3 text-sm font-extrabold text-slate-600 dark:text-slate-300 hover:!border-brand-300 dark:hover:!border-brand-700 transition-colors">
        <span className="flex items-center gap-2"><VisualIdentityIcon asset="tools" className="h-8 w-8" sizes="32px" />{t("pages.tools")}</span>
        <span aria-hidden className="text-slate-400 dark:text-slate-500">→</span>
      </Link>
    </div>
  );
}
