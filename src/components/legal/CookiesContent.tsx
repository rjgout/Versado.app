"use client";

import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";

export default function CookiesContent() {
  const t = useT();
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 dark:text-slate-200">
      <h1 tabIndex={-1} className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("cookies.title")}</h1>

      <p>{rich(t("cookies.intro"), { strong: <strong>{t("cookies.strong")}</strong> })}</p>

      <h2 className="font-extrabold text-lg mt-2">{t("cookies.which")}</h2>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-slate-200 dark:border-slate-700">
            <th className="py-2 pr-4">{t("cookies.name")}</th>
            <th className="py-2 pr-4">{t("cookies.purpose")}</th>
            <th className="py-2">{t("cookies.retention")}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">bvm_session</td>
            <td className="py-2 pr-4">{t("cookies.sessionPurpose")}</td>
            <td className="py-2">{t("cookies.sessionRetention")}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2">{t("cookies.future")}</p>
    </div>
  );
}
