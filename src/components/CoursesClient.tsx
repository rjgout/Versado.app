"use client";

import CoursesView, { type CourseView, type CatalogCourseView } from "./CoursesView";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { applyPersonalOrder, fetchListOrder } from "@/lib/listOrder";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { useCourseManagement } from "@/components/courses/useCourseManagement";

// Leren: je eigen cursussen als kaarten (zie docs/KAARTEN.md). De huidige
// cursus staat los bovenaan; de rest beheer je via het kaartmenu en via
// "Cursus toevoegen" weer terugzetten. Verbergen = UserCourseProgress
// .subscribed uit, de voortgang blijft; de volgorde staat in UserListOrder
// ("courses"). Actief wordt een cursus pas als je er een les van opent
// (markCourseStarted), niet door hem te bekijken of toe te voegen.

export default function CoursesClient() {
  const t = useT();
  const [catalogRequested, setCatalogRequested] = useState(false);
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

  return <ManagedCourses courses={courses} catalog={catalog} setCourses={setCourses} setCatalog={setCatalog} refetch={coursesQuery.refetch} orderOverride={orderOverride} onCatalogOpen={() => setCatalogRequested(true)} />;
}

// Aparte component zodat de beheerhook pas draait als de lijst er is (hooks mogen niet na een vroege return).
function ManagedCourses({ courses, catalog, onCatalogOpen, ...source }: Omit<Parameters<typeof useCourseManagement>[0], "courses"> & { courses: CourseView[]; catalog: CatalogCourseView[] | null; onCatalogOpen: () => void }) {
  const { cardSave, addingId, hide, move, add } = useCourseManagement({ courses, ...source });
  return <CoursesView courses={courses} catalog={catalog} failed={cardSave.failed} busy={cardSave.busy} addingId={addingId} hide={hide} move={move} add={add} onCatalogOpen={onCatalogOpen} />;
}
