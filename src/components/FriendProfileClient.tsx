"use client";

import Link from "next/link";
import type { LeagueTier } from "@/generated/prisma/client";
import { Gamepad2, Sparkles, Users } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { fetchJson } from "@/lib/data/fetchJson";
import { useLiveQuery } from "@/lib/data/hooks";
import { translateOr } from "@/lib/i18n/core";
import ProfileCharacterHero from "@/components/ProfileCharacterHero";
import UserTag from "@/components/UserTag";
import SystemIcon from "@/components/versado/SystemIcon";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import { ProfileCard } from "@/components/profile/settings";

type FriendProfile = {
  friend: {
    id: string;
    handle: string;
    discriminator: string;
    avatarEmoji: string | null;
    avatarCharacterId: string | null;
    avatarBackgroundId: string | null;
    avatarFrameId: string | null;
    avatarDecorationId: string | null;
    avatarLightAccentId: string | null;
  };
  sharesAchievements: boolean;
  stats: null | {
    currentStreak: number;
    xpTotal: number;
    tier: LeagueTier | null;
    featuredAchievements: { id: string; slug: string; name: string; description: string; icon: string; position: number }[];
  };
  together: {
    groups: { id: string; name: string; currentStreak: number }[];
    games: { code: string; mode: string; status: "LOBBY" | "IN_PROGRESS" }[];
  };
};

function FeaturedAchievement({ achievement }: { achievement: NonNullable<FriendProfile["stats"]>["featuredAchievements"][number] }) {
  const t = useT();
  const name = translateOr(t, `achievements.${achievement.slug}.name`, achievement.name);
  const description = translateOr(t, `achievements.${achievement.slug}.description`, achievement.description);
  return (
    <div title={description} className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-vs-xp/30 bg-vs-xp-soft p-3 text-center">
      <span className="text-3xl leading-none" aria-hidden>{achievement.icon}</span>
      <span className="text-xs font-bold leading-snug text-vs-fg">{name}</span>
      <span className="sr-only">{description}</span>
    </div>
  );
}

export default function FriendProfileClient({ userId }: { userId: string }) {
  const t = useT();
  const query = useLiveQuery<FriendProfile>(["friend-profile", userId], () => fetchJson<FriendProfile>(`/api/friends/profiles/${encodeURIComponent(userId)}`), {
    scopes: ["friends", "xp", "streak", "competition"],
  });

  if (query.isLoading && !query.data) return <p className="py-8 text-center text-vs-fg-2">{t("common.loading")}</p>;
  if (!query.data) return <p className="py-8 text-center text-vs-fg-2">{t("friends.profileUnavailable")}</p>;

  const { friend, stats, together } = query.data;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
      <section className="overflow-hidden rounded-3xl border border-vs-line bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm dark:from-brand-600 dark:to-brand-900">
        <ProfileCharacterHero
          appearance={{ avatarEmoji: friend.avatarEmoji, avatarCharacterId: friend.avatarCharacterId, avatarBackgroundId: friend.avatarBackgroundId, avatarFrameId: friend.avatarFrameId, avatarDecorationId: friend.avatarDecorationId, avatarLightAccentId: friend.avatarLightAccentId }}
          handle={friend.handle}
          zoomInLabel={t("profile.zoomIn")}
          zoomOutLabel={t("profile.zoomOut")}
        />
        <div className="p-4 sm:p-5">
          <UserTag handle={friend.handle} discriminator={friend.discriminator} className="block [overflow-wrap:anywhere] text-xl font-extrabold text-white" />
          <p className="mt-1 text-sm font-semibold text-brand-100">{t("friends.friendProfileStatus")}</p>
        </div>
      </section>

      {stats ? (
        <>
          <ProfileCard title={t("friends.sharedProgress")}>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="min-w-0 rounded-xl bg-vs-subtle p-3">
                <SystemIcon kind="streak" className="mx-auto h-6 w-6" />
                <p className="mt-1 font-extrabold text-vs-fg">{stats.currentStreak}</p>
                <p className="text-xs font-bold uppercase text-vs-fg-2">{t("profile.streak")}</p>
              </div>
              <div className="min-w-0 rounded-xl bg-vs-subtle p-3">
                <SystemIcon kind="xp" className="mx-auto h-6 w-6" />
                <p className="mt-1 truncate font-extrabold text-vs-fg">{stats.xpTotal}</p>
                <p className="text-xs font-bold uppercase text-vs-fg-2">XP</p>
              </div>
              <div className="min-w-0 rounded-xl bg-vs-subtle p-3">
                {stats.tier ? <DivisionEmblem tier={stats.tier} className="mx-auto h-7 w-7" /> : <Sparkles className="mx-auto h-6 w-6 text-vs-fg-3" aria-hidden />}
                <p className="mt-1 truncate text-sm font-extrabold text-vs-fg">{stats.tier ? t(`tiers.${stats.tier}`) : "—"}</p>
                <p className="text-xs font-bold uppercase text-vs-fg-2">{t("friends.division")}</p>
              </div>
            </div>
          </ProfileCard>
          {stats.featuredAchievements.length > 0 && (
            <ProfileCard title={t("profile.featuredAchievements")}>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stats.featuredAchievements.map((achievement) => <FeaturedAchievement key={achievement.id} achievement={achievement} />)}
              </div>
            </ProfileCard>
          )}
        </>
      ) : (
        <ProfileCard>
          <p className="text-sm text-vs-fg-2">{t("friends.profileNoAchievements")}</p>
        </ProfileCard>
      )}

      {(together.groups.length > 0 || together.games.length > 0) && (
        <ProfileCard title={t("friends.togetherTitle")}>
          <div className="mt-2 divide-y divide-vs-line">
            {together.groups.map((group) => (
              <Link key={group.id} href={`/groups/${group.id}`} className="flex min-h-12 items-center gap-3 py-2 transition hover:text-vs-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">
                <Users className="h-5 w-5 shrink-0 text-vs-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-bold text-vs-fg">{group.name}</span>
                <span className="text-sm font-semibold text-vs-fg-2">{t("friends.groupStreak", { n: group.currentStreak })}</span>
              </Link>
            ))}
            {together.games.map((game) => (
              <Link key={game.code} href={`/live/${game.code}`} className="flex min-h-12 items-center gap-3 py-2 transition hover:text-vs-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">
                <Gamepad2 className="h-5 w-5 shrink-0 text-vs-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-bold text-vs-fg">{t("friends.activeGame")}</span>
                <span className="text-sm font-semibold text-vs-fg-2">{game.status === "LOBBY" ? t("friends.gameLobby") : t("friends.gameInProgress")}</span>
              </Link>
            ))}
          </div>
        </ProfileCard>
      )}
    </div>
  );
}
