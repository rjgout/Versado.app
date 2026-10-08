"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import NavIcon from "@/components/shell/NavIcon";
import { PRIMARY_NAV, activeDestination } from "@/lib/navigation";

// Primaire navigatie op telefoon en tablet: Vandaag, Leren, Spelen,
// Vrienden. Vanaf desktopbreedte (lg) staat dezelfde navigatie in de header
// (PrimaryNav) en verdwijnt deze balk. Profiel zit achter de avatar
// rechtsboven; Competitie en Activiteit zijn tabs onder Vrienden.
export default function BottomNav() {
  const t = useT();
  const active = activeDestination(usePathname());
  return (
    <nav
      // pb-[...]: telt de homeindicator-ruimte van een geïnstalleerde
      // iOS-PWA op (env(safe-area-inset-bottom), zie viewportFit: "cover"
      // in layout.tsx), zodat de navigatie daar nooit onder valt.
      className="vs-motion fixed bottom-0 inset-x-0 z-20 border-t border-vs-line bg-vs-elevated/95 backdrop-blur-md lg:hidden"
      // data-main-nav voor de CSS in globals.css: het aria-label is vertaald.
      data-main-nav
      aria-label={t("nav.main")}
    >
      <div className="mx-auto grid w-full max-w-xl grid-cols-4 gap-x-1 px-2 pt-1.5 pb-[calc(0.375rem+var(--vs-safe-area-bottom))]">
        {PRIMARY_NAV.map((item) => {
          const isActive = item.id === active;
          return (
            <Link
              key={item.id}
              href={item.href}
              data-kompas-target={`nav-${item.id}`}
              aria-current={isActive ? "page" : undefined}
              className={`group flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 text-center text-[0.6875rem] font-bold leading-tight tracking-wide transition-colors vs-wrap ${
                isActive ? "text-vs-accent" : "text-vs-fg-3 hover:text-vs-fg-2"
              }`}
            >
              <span
                className={`flex h-8 w-14 max-w-full items-center justify-center rounded-full transition-colors duration-200 ${
                  isActive ? "bg-vs-accent-soft" : "group-active:bg-vs-subtle"
                }`}
              >
                <NavIcon id={item.id} className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 2} />
              </span>
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
