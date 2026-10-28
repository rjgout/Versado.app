"use client";

import Link from "next/link";
import { useT } from "@/components/I18nProvider";

/**
 * Juridische informatie en contactlinks. `page` staat los onder
 * een volledige pagina (homepagina, uitnodiging); `inline` hoort bij een
 * pagina-shell die hem zelf onderaan zet (zie profile/ProfilePage.tsx): geen
 * eigen marge of zijpadding, die komen van de shell.
 */
export default function Footer({ variant = "page" }: { variant?: "page" | "inline" }) {
  const t = useT();
  const links = (
    <div className="flex gap-4 flex-wrap">
      <Link href="/disclaimer" className="hover:text-brand-600 dark:hover:text-brand-300 underline">
        {t("legalPages.disclaimerTitle")}
      </Link>
      <Link href="/contact" className="hover:text-brand-600 dark:hover:text-brand-300 underline">
        {t("legalPages.contactTitle")}
      </Link>
      <Link href="/privacy" className="hover:text-brand-600 dark:hover:text-brand-300 underline">
        {t("footer.privacy")}
      </Link>
      <Link href="/cookies" className="hover:text-brand-600 dark:hover:text-brand-300 underline">
        {t("footer.cookies")}
      </Link>
    </div>
  );

  if (variant === "inline") {
    return (
      <footer className="flex flex-col gap-2 border-t border-vs-line pt-5 text-xs text-vs-fg-3 sm:text-sm">
        <p>{t("footer.disclaimer")}</p>
        {links}
      </footer>
    );
  }

  return (
    <footer className="mt-16 border-t border-slate-100 dark:border-slate-800 text-sm text-slate-400 dark:text-slate-500">
      <div className="mx-auto max-w-5xl px-4 py-8 flex flex-col gap-3">
        <p>
          {t("footer.disclaimer")}
        </p>
        {links}
      </div>
    </footer>
  );
}
