"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import AdminSection from "@/components/admin/AdminSection";

interface CourseView {
  id: string;
  slug: string;
  type: string;
  name: string;
  enabled: boolean;
  collectionName: string;
}

const COURSE_TYPES = ["FRONT_TO_BACK", "FREE_CHOICE", "READING_LESSONS", "PODCAST", "KIDS", "INTRO", "FSY"] as const;

function CourseRow({ course, onToggle, saving }: { course: CourseView; onToggle: () => void; saving: boolean }) {
  const t = useT();
  return (
    <label
      className={`flex items-center gap-3 rounded-xl p-3 border cursor-pointer ${
        course.enabled
          ? "border-vs-line"
          : "border-vs-danger/30 bg-vs-danger-soft"
      }`}
    >
      <div className="flex-1">
        <p className="text-xs font-bold uppercase text-vs-fg-3">{(COURSE_TYPES as readonly string[]).includes(course.type) ? t(`adminCourses.types.${course.type as (typeof COURSE_TYPES)[number]}`) : course.type}</p>
        <p className="font-bold text-vs-fg">{course.name}</p>
      </div>
      {!course.enabled && (
        <span className="text-xs font-bold uppercase text-vs-danger shrink-0">{t("adminContent.disabled")}</span>
      )}
      <ToggleSwitch checked={course.enabled} onChange={onToggle} disabled={saving} compact />
    </label>
  );
}

export default function AdminCoursesClient() {
  const t = useT();
  const [courses, setCourses] = useState<CourseView[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/courses")
      .then((r) => r.json())
      .then((d) => setCourses(d.courses ?? []));
  }, []);

  async function toggle(course: CourseView) {
    const next = !course.enabled;
    setSavingId(course.id);
    setCourses((cur) => cur?.map((c) => (c.id === course.id ? { ...c, enabled: next } : c)) ?? null);
    await fetch(`/api/admin/courses/${course.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => {});
    setSavingId(null);
  }

  return (
    <AdminSection title={t("adminCourses.title")}>

      <p className="text-sm text-vs-fg-2">
        {t("adminCourses.intro")}
      </p>

      {!courses ? (
        <p className="text-vs-fg-3">{t("common.loading")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Per collectie: elke schriftcollectie heeft cursussen met dezelfde naam. */}
          {Array.from(new Set(courses.map((c) => c.collectionName))).map((collectionName) => (
            <div key={collectionName} className="flex flex-col gap-2">
              <h3 className="text-sm font-extrabold text-vs-fg-2">{collectionName}</h3>
              {courses
                .filter((c) => c.collectionName === collectionName)
                .map((course) => (
                  <CourseRow key={course.id} course={course} saving={savingId === course.id} onToggle={() => toggle(course)} />
                ))}
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
