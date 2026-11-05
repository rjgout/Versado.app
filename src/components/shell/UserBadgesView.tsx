"use client";

import type { ReactNode } from "react";
import { AppLink } from "@/components/navigation/AppNavigation";
import SystemIcon from "@/components/versado/SystemIcon";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import type { LeagueTier } from "@/generated/prisma/enums";
import type { MessageKey } from "@/lib/i18n/core";

function Badge({ interactive, href, children, ...props }: { interactive: boolean; href: string; children: ReactNode; title: string; className: string; "aria-label": string }) {
  return interactive ? <AppLink href={href} {...props}>{children}</AppLink> : <span role="img" {...props}>{children}</span>;
}

/** De bestaande reeks-/XP-/divisiepresentatie, met alleen bevestigde serverwaarden. */
export default function UserBadgesView({ streak, xp, studiedToday, tier, interactive = true }: { streak: number; xp: number; studiedToday: boolean; tier: LeagueTier | null; interactive?: boolean }) {
  const t = useT(), locale = getLanguage(useUiLanguage()).intlLocale;
  const values = { streak, xp, studiedToday };
  const number = (n: number) => new Intl.NumberFormat(locale, n >= 10000 ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(n);
  const chip = "vs-motion flex h-10 items-center gap-1.5 rounded-full px-2.5 text-sm font-extrabold tabular-nums transition-colors";

  return (
    <div className="flex flex-wrap items-center justify-end gap-0.5 sm:gap-1">
      <Badge interactive={interactive}
        href="/streak"
        title={t("header.streak")}
        aria-label={t("header.streakAria", { n: values.streak })}
        className={`${chip} ${values.studiedToday ? "text-vs-streak hover:bg-vs-streak-soft" : "text-vs-fg-3 hover:bg-vs-subtle"}`}
      >
        <SystemIcon kind="streak" className="h-[18px] w-[18px]" fill={values.studiedToday ? "currentColor" : "none"} aria-hidden />
        {number(values.streak)}
      </Badge>
      <Badge interactive={interactive} href="/xp" title={t("header.xp")} aria-label={t("header.xpAria", { n: values.xp })} className={`${chip} text-vs-xp hover:bg-vs-xp-soft`}>
        <SystemIcon kind="xp" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden />
        {number(values.xp)}
      </Badge>
      {tier && (
        <Badge interactive={interactive}
          href="/competition"
          title={t(`tiers.${tier}` as MessageKey)}
          aria-label={t("header.divisionAria", { name: t(`tiers.${tier}` as MessageKey) })}
          // Op de kleinste schermen alleen het embleem: de naam past er niet naast.
          className={`${chip} hidden min-[380px]:flex text-vs-league hover:bg-vs-league-soft`}
        >
          <DivisionEmblem tier={tier} className="h-6 w-6" />
          <span className="hidden sm:inline">{t(`tiers.${tier}` as MessageKey)}</span>
        </Badge>
      )}
    </div>
  );
}
