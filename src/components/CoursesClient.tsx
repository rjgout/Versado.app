"use client";

import CoursesView, { type CourseView, type CatalogCourseView } from "./CoursesView";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { applyPersonalOrder, fetchListOrder, saveListOrder } from "@/lib/listOrder";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { useCardListSave } from "@/components/versado/useCardListSave";

// Leren: je eigen cursussen als kaarten (zie docs/KAARTEN.md). De huidige
// cursus staat los bovenaan; de rest beheer je via het kaartmenu en via
// "Cursus toevoegen" weer terugzetten. Verbergen = UserCourseProgress
// .subscribed uit, de voortgang blijft; de volgorde staat in UserListOrder
// ("courses"). Actief wordt een cursus pas als je er een les van opent
// (markCourseStarted), niet door hem te bekijken of toe te voegen.

export default function CoursesClient() {
  const t = useT();
  const cardSave = useCardListSave();
  const [catalogRequested, setCatalogRequested] = useState(false);
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
    { scopes: ["courses", "progress", "studySteps"], contentScoped: true }
  );
  const courses = coursesQuery.data ?? null;
  const setCourses = coursesQuery.setData;
  const loadError = !courses && coursesQuery.error
    ? coursesQuery.error instanceof Error && !coursesQuery.error.message.startsWith("HTTP ")
      ? coursesQuery.error.message
      : t("courses.error")
    : null;

  // Ook het aanbod volgt de contentkey; een open of eerder geladen CFM-catalogus mag niet meeverhuizen.
  const catalogQuery = useLiveQuery<CatalogCourseView[]>(["courses", "catalog"], async () => {
    const data = await fetchJson<{ courses: CatalogCourseView[] }>("/api/courses/catalog");
    return data.courses;
  }, { scopes: ["courses"], contentScoped: true, enabled: catalogRequested });
  const catalog = catalogQuery.data ?? null;
  const setCatalog = catalogQuery.setData;

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
    const previousOrder = courses!.map((course) => course.id);
    void cardSave.run(
      () => saveListOrder("courses", next.map((course) => course.id)),
      () => setCourses(next),
      () => setCourses((current) => applyPersonalOrder(current ?? [], previousOrder))
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
    const saved = await cardSave.run(async () => {
      await liveMutation(() => fetchJson(`/api/courses/${courseId}/unsubscribe`, { method: "POST" }), {
        invalidates: "coursesChanged",
        onSuccess: () => setCourses((cur) => cur?.filter((c) => c.id !== courseId) ?? []),
      });
    });
    if (!saved) return;
  }

  async function add(courseId: string) {
    if (cardSave.busy) return;
    setAddingId(courseId);
    // Achteraan, ook als de cursus eerder al eens ergens anders stond.
    const order = [...(courses ?? []).map((c) => c.id), courseId];
    const saved = await cardSave.run(async () => {
      orderOverride.current = order;
      try {
        await liveMutation(() => fetchJson(`/api/courses/${courseId}/subscribe`, { method: "POST" }), {
          invalidates: "coursesChanged",
        });
        await saveListOrder("courses", order);
      } catch (error) {
        orderOverride.current = null;
        await coursesQuery.refetch();
        throw error;
      }
    });
    setAddingId(null);
    if (!saved) return;
    setCatalog((cur) => cur?.filter((c) => c.id !== courseId));
  }

  return <CoursesView courses={courses} catalog={catalog} failed={cardSave.failed} busy={cardSave.busy} addingId={addingId} hide={hide} move={move} add={add} onCatalogOpen={() => setCatalogRequested(true)} />;
}
