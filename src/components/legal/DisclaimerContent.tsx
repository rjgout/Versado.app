"use client";

import { useT } from "@/components/I18nProvider";
import { AppLink } from "@/components/navigation/AppNavigation";

export default function DisclaimerContent() {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 text-vs-fg">
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("legalPages.disclaimerTitle")}</h1>
      <p>{t("legalPages.intro")}</p>
      <p>{t("footer.disclaimer")}</p>
      {(["content", "sources", "liability"] as const).map(section => (
        <section key={section} className="flex flex-col gap-2">
          <h2 className="mt-2 text-lg font-extrabold">{t(`legalPages.${section}Title`)}</h2>
          <p>{t(`legalPages.${section}Text`)}</p>
        </section>
      ))}
      <h2 className="mt-2 text-lg font-extrabold">{t("legalPages.questionsTitle")}</h2>
      <div className="flex flex-wrap gap-4">
        <AppLink href="/contact" className="underline text-vs-accent">{t("legalPages.contactTitle")}</AppLink>
        <AppLink href="/privacy" className="underline text-vs-accent">{t("footer.privacy")}</AppLink>
        <AppLink href="/cookies" className="underline text-vs-accent">{t("footer.cookies")}</AppLink>
      </div>
    </div>
  );
}
