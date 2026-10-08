"use client";

import { useEffect, useState } from "react";
import UserTag from "@/components/UserTag";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { getLanguage } from "@/lib/languages";
import AdminSection from "@/components/admin/AdminSection";

const STATUS_OPTIONS = ["NEW", "IN_PROGRESS", "DONE", "WONT_DO"] as const;
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
  user: { email: string; handle: string; discriminator: string };
}

export default function FeedbackAdminClient() {
  const t = useT();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/feedback");
    if (res.ok) setReports((await res.json()).reports);
  }

  useEffect(() => {
    load();
  }, []);

  async function changeStatus(id: string, status: string) {
    setUpdatingId(id);
    setReports((cur) => cur?.map((r) => (r.id === id ? { ...r, status } : r)) ?? null);
    await fetch(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
    setUpdatingId(null);
  }

  return (
    <AdminSection title={t("pages.feedback")}>

      {!reports ? (
        <p className="text-vs-fg-3">{t("common.loading")}</p>
      ) : reports.length === 0 ? (
        <p className="text-vs-fg-3">{t("adminFeedback.none")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r) => (
            <div key={r.id} className="border border-vs-line rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <p className="font-bold text-sm text-vs-fg">
                    <UserTag handle={r.user.handle} discriminator={r.user.discriminator} />{" "}
                    <span className="font-normal text-vs-fg-3">({r.user.email})</span>
                  </p>
                  <p className="text-xs text-vs-fg-3">
                    {new Date(r.createdAt).toLocaleString(intlLocale)}
                  </p>
                </div>
                <AppSelect
                  className={`text-xs font-bold uppercase rounded-full px-2 py-1 border-0 ${STATUS_CLASSES[r.status] ?? STATUS_CLASSES.NEW}`}
                  value={r.status}
                  disabled={updatingId === r.id}
                  onChange={(value) => changeStatus(r.id, value)}
                  ariaLabel={t("feedback.status.NEW")}
                  options={STATUS_OPTIONS.map((s) => ({ value: s, label: t(`feedback.status.${s}`) }))}
                />
              </div>
              <p className="text-sm whitespace-pre-wrap text-vs-fg">{r.message}</p>
              {r.screenshot && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.screenshot}
                  alt={t("feedback.screenshot")}
                  className="max-h-40 rounded-lg border border-vs-line self-start"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
