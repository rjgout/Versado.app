"use client";

import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { useEffect, useState } from "react";
import { ChevronRight, UsersRound } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { interactiveCard } from "@/components/versado/styles";

/** De ingang naar Groepen op de vriendenpagina, met het aantal groepen en open uitnodigingen. */
export default function GroupsEntryCard() {
  const t = useT();
  const [counts, setCounts] = useState<{ groups: number; invites: number } | null>(null);

  useEffect(() => {
    fetch("/api/groups")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setCounts({ groups: data.groups.length, invites: data.invites.length }))
      .catch(() => {});
  }, []);

  const meta = counts
    ? [
        counts.groups === 1 ? t("together.groupsPage.entryCountOne") : t("together.groupsPage.entryCountMany", { n: counts.groups }),
        counts.invites > 0 ? (counts.invites === 1 ? t("together.groupsPage.entryInvitesOne") : t("together.groupsPage.entryInvitesMany", { n: counts.invites })) : null,
      ].filter(Boolean)
    : [];

  return (
    <Link href="/groups" className={`${interactiveCard} flex items-center gap-3 p-4`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-vs-accent-soft text-vs-accent">
        <UsersRound className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-extrabold text-vs-fg">{t("together.groupsPage.entryTitle")}</span>
          {counts && counts.invites > 0 && <span className="h-2 w-2 rounded-full bg-vs-accent" aria-hidden />}
        </span>
        <span className="block text-sm text-vs-fg-2">{t("together.groupsPage.entryText")}</span>
        {meta.length > 0 && <span className="mt-0.5 block text-xs font-semibold text-vs-fg-3">{meta.join(" · ")}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />
    </Link>
  );
}
