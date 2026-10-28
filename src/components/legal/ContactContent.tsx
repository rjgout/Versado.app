"use client";

import { useT } from "@/components/I18nProvider";

export default function ContactContent() {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 text-vs-fg">
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("legalPages.contactTitle")}</h1>
      <p>{t("legalPages.contactIntro")}</p>
      <address className="flex flex-col gap-2 not-italic">
        <span className="font-bold">Raphael Gout</span>
        <a href="mailto:raphael@versado.app" className="w-fit min-w-0 max-w-full break-words text-vs-accent underline">raphael@versado.app</a>
      </address>
      <p>{t("legalPages.contactHelp")}</p>
    </div>
  );
}
