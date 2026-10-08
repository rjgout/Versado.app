"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import NavIcon from "@/components/shell/NavIcon";
import { PRIMARY_NAV, activeDestination } from "@/lib/navigation";

// Dezelfde vier bestemmingen als BottomNav, maar in de header vanaf
// desktopbreedte: daar is een balk onderaan geen natuurlijke plek.
export default function PrimaryNav() {
  const t = useT();
  const active = activeDestination(usePathname());
  return (
    <nav aria-label={t("nav.main")} className="vs-motion hidden lg:flex items-center gap-1">
      {PRIMARY_NAV.map((item) => {
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            data-kompas-target={`nav-${item.id}`}
            aria-current={isActive ? "page" : undefined}
            className={`flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-bold transition-colors ${
              isActive ? "bg-vs-accent-soft text-vs-accent" : "text-vs-fg-2 hover:bg-vs-subtle hover:text-vs-fg"
            }`}
          >
            <NavIcon id={item.id} className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.4 : 2} />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
