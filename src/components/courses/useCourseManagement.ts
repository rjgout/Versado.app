"use client";

import { useState, type MutableRefObject } from "react";
import type { CatalogCourseView, CourseView } from "@/components/CoursesView";
import { useCardListSave } from "@/components/versado/useCardListSave";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { applyPersonalOrder, saveListOrder } from "@/lib/listOrder";

type Update<T> = T | ((previous: T | undefined) => T | undefined);
export interface CourseManagementSource {
  courses: CourseView[];
  setCourses: (update: Update<CourseView[]>) => void;
  setCatalog: (update: Update<CatalogCourseView[]>) => void;
  /** Haalt de lijst opnieuw op na een mislukte of afwijkende schrijfactie. */
  refetch: () => Promise<unknown> | void;
  /** Een net gekozen volgorde, voordat de opgeslagen volgorde bijgewerkt is (alleen web). */
  orderOverride?: MutableRefObject<string[] | null>;
}

/** De ene cursusbeheerlogica voor web en native: verbergen (alleen `subscribed` uit, voortgang
 * blijft), toevoegen (achteraan) en de eigen volgorde (`UserListOrder`, "courses"). Alle
 * schrijfacties lopen via dezelfde endpoints; de server blijft de bron van waarheid. */
export function useCourseManagement({ courses, setCourses, setCatalog, refetch, orderOverride }: CourseManagementSource) {
  const cardSave = useCardListSave();
  const [addingId, setAddingId] = useState<string | null>(null);
  // De huidige cursus staat altijd bovenaan, dus vooraan in de opgeslagen volgorde.
  const activeCourse = courses.find(course => course.isActive) ?? null;
  const others = courses.filter(course => !course.isActive);

  function saveOrder(nextOthers: CourseView[]) {
    const next = activeCourse ? [activeCourse, ...nextOthers] : nextOthers;
    const previousOrder = courses.map(course => course.id);
    void cardSave.run(
      () => saveListOrder("courses", next.map(course => course.id)),
      () => setCourses(next),
      () => setCourses(current => applyPersonalOrder(current ?? [], previousOrder)),
    );
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= others.length) return;
    const next = [...others];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    saveOrder(next);
  }
  // Verbergen verwijdert nooit voortgang of inhoud, dus geen bevestiging; terugzetten kan altijd.
  async function hide(courseId: string) {
    await cardSave.run(async () => {
      await liveMutation(() => fetchJson(`/api/courses/${courseId}/unsubscribe`, { method: "POST" }), {
        invalidates: "coursesChanged",
        onSuccess: () => setCourses(current => current?.filter(course => course.id !== courseId) ?? []),
      });
    });
  }
  async function add(courseId: string) {
    if (cardSave.busy) return;
    setAddingId(courseId);
    const order = [...courses.map(course => course.id), courseId];
    const saved = await cardSave.run(async () => {
      if (orderOverride) orderOverride.current = order;
      try {
        await liveMutation(() => fetchJson(`/api/courses/${courseId}/subscribe`, { method: "POST" }), { invalidates: "coursesChanged" });
        await saveListOrder("courses", order);
        // De lijst volgde op de eerste invalidatie nog de oude volgorde.
        if (!orderOverride) await refetch();
      } catch (error) {
        if (orderOverride) orderOverride.current = null;
        await refetch();
        throw error;
      }
    });
    setAddingId(null);
    if (saved) setCatalog(current => current?.filter(course => course.id !== courseId));
  }
  return { cardSave, addingId, hide, move, add };
}
