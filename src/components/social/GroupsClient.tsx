"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Plus, ShieldCheck, Trophy, UsersRound } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import UserAvatar from "@/components/UserAvatar";
import { interactiveCard, primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import GroupTodayLine, { type GroupTodayData } from "@/components/social/GroupTodayLine";
import { SocialHeading, StreakBadge, socialRequest, type Person } from "@/components/social/shared";

interface GroupsData {
  groups: { id: string; name: string; memberCount: number; currentStreak: number; streakInterruptedDay: string | null; role: "ADMIN" | "MEMBER"; today: GroupTodayData }[];
  invites: { id: string; inviter: Person; group: { id: string; name: string; memberCount: number; currentStreak: number } }[];
  limit: number;
}

/** Groepenoverzicht: uitnodigingen, je eigen groepen met de stand van vandaag, aanmaken en de ranglijst. */
export default function GroupsClient() {
  const t = useT();
  const [data, setData] = useState<GroupsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/groups").catch(() => null);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(inviteId: string, accept: boolean) {
    setMessage(null);
    const result = await socialRequest(`/api/group-invites/${inviteId}`, { accept });
    if (!result.ok) setMessage(result.error ?? t("together.common.error"));
    load();
  }

  const members = (n: number) => (n === 1 ? t("together.common.membersOne") : t("together.common.membersMany", { n }));
  const full = !!data && data.groups.length >= data.limit;

  return (
    <div className="vs-motion mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-vs-fg">
          <UsersRound className="h-6 w-6 text-vs-accent" aria-hidden />
          {t("together.pages.groups")}
        </h1>
        <p className="max-w-2xl text-sm text-vs-fg-2">{t("together.groupsPage.intro")}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {full ? (
            <span className={`${secondaryButton} pointer-events-none opacity-60`}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("together.groupsPage.create")}
            </span>
          ) : (
            <Link href="/groups/new" className={primaryButton}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("together.groupsPage.create")}
            </Link>
          )}
          <Link href="/groups/leaderboard" className={secondaryButton}>
            <Trophy className="h-4 w-4" aria-hidden />
            {t("together.groupsPage.leaderboard")}
          </Link>
        </div>
      </header>

      {message && (
        <p role="status" className="text-sm font-semibold text-vs-danger">
          {message}
        </p>
      )}
      {failed && !data && <p className="text-sm text-vs-danger">{t("together.common.error")}</p>}
      {!data && !failed && <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>}

      {data && data.invites.length > 0 && (
        <section aria-labelledby="group-invites" className="flex flex-col gap-2.5">
          <SocialHeading id="group-invites" title={t("together.groupsPage.invitesTitle")} />
          {data.invites.map((invite) => (
            <div key={invite.id} className={`${surfaceCard} flex flex-wrap items-center gap-3 p-4`}>
              <UserAvatar id={invite.inviter.id} handle={invite.inviter.handle} avatarEmoji={invite.inviter.avatarEmoji} size="md" />
              <div className="min-w-[12rem] flex-1">
                <p className="text-sm text-vs-fg-2">{t("together.groupsPage.invitedBy", { name: invite.inviter.handle })}</p>
                <p className="truncate font-extrabold text-vs-fg">{t("together.groupsPage.inviteFor", { group: invite.group.name })}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-vs-fg-3">
                  {members(invite.group.memberCount)}
                  <StreakBadge days={invite.group.currentStreak} />
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className={primaryButton} onClick={() => respond(invite.id, true)}>
                  {t("together.groupsPage.join")}
                </button>
                <button type="button" className={secondaryButton} onClick={() => respond(invite.id, false)}>
                  {t("together.groupsPage.decline")}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {data && (
        <section aria-labelledby="my-groups" className="flex flex-col gap-2.5">
          <SocialHeading id="my-groups" title={t("together.groupsPage.mine")} count={t("together.groupsPage.count", { n: data.groups.length, max: data.limit })} />
          {data.groups.length === 0 ? (
            <p className={`${surfaceCard} p-4 text-sm text-vs-fg-2`}>{t("together.groupsPage.empty")}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.groups.map((group) => (
                <li key={group.id}>
                  <Link href={`/groups/${group.id}`} className={`${interactiveCard} flex h-full flex-col gap-3 p-4`}>
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 font-extrabold text-vs-fg">
                          <span className="truncate">{group.name}</span>
                          {group.role === "ADMIN" && <ShieldCheck className="h-4 w-4 shrink-0 text-vs-fg-3" aria-label={t("together.common.admin")} />}
                        </p>
                        <p className="text-xs font-semibold text-vs-fg-3">{members(group.memberCount)}</p>
                      </div>
                      <StreakBadge days={group.currentStreak} />
                      <ChevronRight className="h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />
                    </div>
                    {group.streakInterruptedDay && <p className="text-xs font-semibold text-vs-accent">{t("together.group.interruptedShort")}</p>}
                    <GroupTodayLine today={group.today} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
