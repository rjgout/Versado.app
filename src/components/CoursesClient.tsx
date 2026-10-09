"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, EyeOff } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import type { MessageKey } from "@/lib/i18n/core";
import { SortableList } from "@/components/SortableList";
import { applyPersonalOrder, fetchListOrder, saveListOrder } from "@/lib/listOrder";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { CardPicker, CardProgress, ContentCard, StatusChip, cardActions, type PickerItem } from "@/components/versado/ContentCard";
import VisualIdentityIcon from "@/components/versado/VisualIdentityIcon";

// Leren: je eigen cursussen als kaarten (zie docs/KAARTEN.md). De huidige
// cursus staat los bovenaan; de rest kun je verslepen, verbergen en via
// "Cursus toevoegen" weer terugzetten. Verbergen = UserCourseProgress
// .subscribed uit, de voortgang blijft; de volgorde staat in UserListOrder
// ("courses"). Actief wordt een cursus pas als je er een les van opent
// (markCourseStarted), niet door hem te bekijken of toe te voegen.

interface CourseView {
  id: string;
  slug: string;
  type: "FRONT_TO_BACK" | "FREE_CHOICE" | "BY_BOOK" | "PODCAST" | "KIDS" | "INTRO" | "READING_LESSONS" | "FSY";
  name: string;
  description: string | null;
  totalChapters: number;
  unitPlural?: string;
  completedCount: number;
  xpAvailable: number;
  isActive: boolean;
  currentChapter: { id: string; bookName: string; number: number } | null;
  resumeHref: string;
  artwork: string[];
}

interface CatalogCourseView {
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
};

const CARD_SIZES = "(min-width: 1024px) 320px, (min-width: 768px) 50vw, 100vw";

export default function CoursesClient() {
  const t = useT();
  const [catalog, setCatalog] = useState<CatalogCourseView[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  /** Een volgorde die net lokaal is gekozen (na toevoegen), voordat de opgeslagen volgorde bijgewerkt is. */
  const orderOverride = useRef<string[] | null>(null);

  // Cursussen horen bij de gekozen content en taal: de key krijgt die automatisch mee
  // (contentScoped), dus na een wissel verschijnt nooit de lijst van de vorige content.
  // Voortgang verandert door afgeronde activiteiten (scope progress), de lijst door
  // toevoegen/verbergen (scope courses); zie DATA_EVENTS in src/lib/data/scopes.ts.
  const coursesQuery = useLiveQuery<CourseView[]>(
    ["courses", "list"],
    async () => {
      const order = orderOverride.current;
      orderOverride.current = null;
      const [data, savedOrder] = await Promise.all([
        fetchJson<{ courses?: CourseView[] }>("/api/courses"),
        order ? Promise.resolve(order) : fetchListOrder("courses"),
      ]);
      return applyPersonalOrder(data.courses ?? [], savedOrder);
    },
    { scopes: ["courses", "progress"], contentScoped: true }
  );
  const courses = coursesQuery.data ?? null;
  const setCourses = coursesQuery.setData;
  const loadError = !courses && coursesQuery.error
    ? coursesQuery.error instanceof Error && !coursesQuery.error.message.startsWith("HTTP ")
      ? coursesQuery.error.message
      : t("courses.error")
    : null;

  async function loadCatalog() {
    const res = await fetch("/api/courses/catalog");
    if (res.ok) setCatalog((await res.json()).courses);
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-3">
        <p className="text-red-600 dark:text-red-400 font-semibold">{loadError}</p>
        <button className="btn-secondary self-center" onClick={() => window.location.reload()}>
          {t("courses.retry")}
        </button>
      </div>
    );
  }

  if (!courses) {
    return <p className="text-center text-vs-fg-3">{t("courses.loading")}</p>;
  }

  const activeCourse = courses.find((course) => course.isActive) ?? null;
  const others = courses.filter((course) => !course.isActive);

  // De huidige cursus staat altijd bovenaan, dus vooraan in de opgeslagen
  // volgorde; de rest in de volgorde van de lijst.
  function saveOrder(nextOthers: CourseView[]) {
    const next = activeCourse ? [activeCourse, ...nextOthers] : nextOthers;
    setCourses(next);
    saveListOrder(
      "courses",
      next.map((c) => c.id)
    );
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= others.length) return;
    const next = [...others];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    saveOrder(next);
  }

  // Verbergen uit het overzicht: de voortgang blijft (unsubscribe zet alleen
  // subscribed uit), dus geen bevestiging nodig; terugzetten kan altijd.
  async function hide(courseId: string) {
    try {
      await liveMutation(() => fetchJson(`/api/courses/${courseId}/unsubscribe`, { method: "POST" }), {
        invalidates: "coursesChanged",
        onSuccess: () => setCourses((cur) => cur?.filter((c) => c.id !== courseId) ?? []),
      });
    } catch {
      return;
    }
    setCatalog(null);
  }

  async function add(courseId: string) {
    setAddingId(courseId);
    // Achteraan, ook als de cursus eerder al eens ergens anders stond.
    const order = [...(courses ?? []).map((c) => c.id), courseId];
    orderOverride.current = order;
    try {
      await liveMutation(() => fetchJson(`/api/courses/${courseId}/subscribe`, { method: "POST" }), {
        invalidates: "coursesChanged",
      });
    } catch {
      orderOverride.current = null;
      return;
    } finally {
      setAddingId(null);
    }
    saveListOrder("courses", order);
    setCatalog((cur) => cur?.filter((c) => c.id !== courseId) ?? null);
  }

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
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("pages.courses")}</h1>
        <p className="text-sm text-vs-fg-2">{t("courses.intro")}</p>
      </div>

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
            artwork={{ kind: "course", keys: activeCourse.artwork, sizes: "(min-width: 1024px) 480px, 100vw" }}
            label={t(TYPE_LABELS[activeCourse.type])}
            chips={chipsOf(activeCourse)}
            description={activeCourse.description}
            actions={[{ label: t("cards.hide"), icon: EyeOff, onSelect: () => hide(activeCourse.id) }]}
          >
            {activeCourse.currentChapter && (
              <p className="text-sm font-bold text-vs-fg">
                {t("courses.next", { chapter: `${activeCourse.currentChapter.bookName} ${activeCourse.currentChapter.number}` }).replace(/^ — /, "")}
              </p>
            )}
            {progressOf(activeCourse)}
            {/* Hervatten bij de volgende stap; de afbeelding en titel openen
                het cursusoverzicht. */}
            <Link
              href={activeCourse.resumeHref}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl bg-vs-accent px-4 text-sm font-extrabold text-vs-on-accent transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vs-surface"
            >
              {t("courses.continue").replace(/\s*→\s*$/, "")}
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
          <SortableList
            dndId="courses-list"
            items={others}
            onReorder={saveOrder}
            getItemLabel={(course) => course.name}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
            renderItem={(course, handle) => (
              <ContentCard
                title={course.name}
                href={`/courses/${course.id}`}
                artwork={{ kind: "course", keys: course.artwork, sizes: CARD_SIZES }}
                label={t(TYPE_LABELS[course.type])}
                chips={chipsOf(course)}
                description={course.description}
                handle={handle}
                priority={!activeCourse && others.indexOf(course) === 0}
                actions={cardActions({ t, index: others.indexOf(course), count: others.length, onMove: move, onHide: () => hide(course.id) })}
              >
                {progressOf(course)}
              </ContentCard>
            )}
          />
        </section>
      )}

      <div data-kompas-target="learn-add">
      <CardPicker
        addLabel={t("courses.addCourse")}
        addHint={t("courses.addCourseHint")}
        emptyText={t("courses.allAdded")}
        items={pickerItems}
        busyId={addingId}
        onOpen={() => {
          if (!catalog) loadCatalog();
        }}
        onAdd={add}
      />
      </div>

      <Link href="/tools" className="card !py-3 flex items-center justify-between gap-3 text-sm font-extrabold text-slate-600 dark:text-slate-300 hover:!border-brand-300 dark:hover:!border-brand-700 transition-colors">
        <span className="flex items-center gap-2"><VisualIdentityIcon asset="tools" className="h-8 w-8" sizes="32px" />{t("pages.tools")}</span>
        <span aria-hidden className="text-slate-400 dark:text-slate-500">→</span>
      </Link>
    </div>
  );
}
