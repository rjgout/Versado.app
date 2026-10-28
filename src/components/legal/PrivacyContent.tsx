"use client";

import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";
import { AppLink } from "@/components/navigation/AppNavigation";

export default function PrivacyContent() {
  const t = useT();
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 dark:text-slate-200">
      <h1 tabIndex={-1} className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("privacy.title")}</h1>

      <p>{t("privacy.independent")}</p>

      <h2 className="font-extrabold text-lg mt-2">{t("privacy.whatData")}</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>{t("privacy.data1")}</li>
        <li>{t("privacy.data2")}</li>
        <li>{t("privacy.data3")}</li>
        <li>{t("privacy.data4")}</li>
        <li>{t("privacy.data5")}</li>
      </ul>

      <h2 className="font-extrabold text-lg mt-2">{t("privacy.whyData")}</h2>
      <p>{t("privacy.whyText")}</p>

      <h2 className="font-extrabold text-lg mt-2">{t("privacy.howLong")}</h2>
      <p>{t("privacy.howLongText")}</p>

      <h2 className="font-extrabold text-lg mt-2">{t("mailLog.privacyTitle")}</h2>
      <p>{t("mailLog.privacyText")}</p>

      <h2 className="font-extrabold text-lg mt-2">{t("privacy.rights")}</h2>
      <p>
        {rich(t("privacy.rightsText"), {
          link: (
            <AppLink href="/profile" className="underline text-brand-600 dark:text-brand-300">
              {t("privacy.profileLink")}
            </AppLink>
          ),
        })}
      </p>

      <h2 className="font-extrabold text-lg mt-2">{t("privacy.cookies")}</h2>
      <p>
        {rich(t("privacy.cookiesText"), {
          link: (
            <AppLink href="/cookies" className="underline text-brand-600 dark:text-brand-300">
              {t("privacy.cookieLink")}
            </AppLink>
          ),
        })}
      </p>
    </div>
  );
}
