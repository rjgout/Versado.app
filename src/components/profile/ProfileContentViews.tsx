"use client";

import { useState } from "react";
import type { LeagueTier } from "@/generated/prisma/client";
import { ArrowDown, ArrowUp, Lock, Plus, X } from "lucide-react";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import RankMedal from "@/components/versado/RankMedal";
import AchievementIcon from "@/components/versado/AchievementIcon";
import { useT } from "@/components/I18nProvider";
import { translateOr } from "@/lib/i18n/core";
import { ProfileCard } from "@/components/profile/settings";
import { SettingsButton, SettingsStatus } from "@/components/profile/settings";
import { DragHandle, SortableList } from "@/components/SortableList";
import type { AchievementView, ProfileData } from "@/components/profile/profileData";

// Inhoudelijke profielonderdelen: geen instellingen, dus geen rijen met
// schakelaars, maar wel dezelfde kaarten, kopjes en tokens als de rest van
// het profiel (zie docs/PROFIEL.md).

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="font-extrabold text-vs-fg">{value}</div>
      <div className="text-xs font-bold uppercase text-vs-fg-3">{label}</div>
    </div>
  );
}

export function CompetitionView({ data }: { data: ProfileData }) {
  const t = useT();
  const tier = (value: LeagueTier) => t(`tiers.${value}`);
  const medals = [
    [1, data.medals.gold, "profile.medalGold"],
    [2, data.medals.silver, "profile.medalSilver"],
    [3, data.medals.bronze, "profile.medalBronze"],
  ] as const;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-vs-xp/30 bg-vs-xp-soft p-4 sm:p-5">
        <div className="flex min-w-0 flex-col items-start gap-1">
          {data.tier && <DivisionEmblem tier={data.tier} className="h-20 w-20" />}
          <p className="text-2xl font-extrabold text-vs-xp">{data.tier ? tier(data.tier) : "—"}</p>
          <p className="text-xs font-bold uppercase text-vs-fg-2">
            {data.groupPosition ? `#${data.groupPosition} · ` : ""}
            {t("profile.thisWeek")}
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-1 text-right">
          {data.bestTierEver && <DivisionEmblem tier={data.bestTierEver} className="h-16 w-16" />}
          <p className="text-lg font-extrabold text-vs-xp">{data.bestTierEver ? tier(data.bestTierEver) : "—"}</p>
          <p className="text-xs font-bold uppercase text-vs-fg-2">{t("profile.bestTier")}</p>
        </div>
      </section>

      <ProfileCard title={t("profile.medals")} description={t("profile.medalsHint")}>
        <div className="mt-1 grid grid-cols-3 gap-2 text-center">
          {medals.map(([rank, count, label]) => (
            <div key={rank} className="flex flex-col items-center gap-1">
              <RankMedal rank={rank} className="h-10 w-10 text-lg" />
              <span className="text-xl font-extrabold text-vs-fg">{count}</span>
              <span className="text-xs font-bold uppercase text-vs-fg-2">{t(label)}</span>
            </div>
          ))}
        </div>
      </ProfileCard>

      {/* Twee kolommen op een telefoon: met vier liepen de labels in elkaar. */}
      <ProfileCard>
        <div className="grid grid-cols-2 gap-x-2 gap-y-4 text-center sm:grid-cols-4">
          <Stat value={data.lifetimePromotions.toString()} label={t("profile.promotions")} />
          <Stat value={data.lifetimeDemotions.toString()} label={t("profile.demotions")} />
          <Stat value={data.competitionsWon.toString()} label={t("profile.competitions")} />
          <Stat value={data.bestNationalRank ? `#${data.bestNationalRank}` : "—"} label={t("profile.nationalRank")} />
        </div>
      </ProfileCard>

      {data.seasons.length > 0 && (
        <ProfileCard title={t("pages.seasons")}>
          <div className="divide-y divide-vs-line">
            {data.seasons.map((season) => (
              <div key={season.seasonIndex} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm">
                <span className="font-bold text-vs-fg">{t("profile.seasonN", { n: season.seasonIndex })}</span>
                <span className="inline-flex items-center gap-2 text-right text-vs-fg-2">
                  <DivisionEmblem tier={season.finalTier} className="h-8 w-8" />
                  {tier(season.finalTier)}
                  {season.finalGroupPosition ? ` — #${season.finalGroupPosition}` : ""}
                </span>
              </div>
            ))}
          </div>
        </ProfileCard>
      )}
    </>
  );
}

function AchievementTile({ achievement, compact = false }: { achievement: AchievementView; compact?: boolean }) {
  const t = useT();
  const name = translateOr(t, `achievements.${achievement.slug}.name`, achievement.name);
  const description = translateOr(t, `achievements.${achievement.slug}.description`, achievement.description);
  return (
    <div title={description} className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border border-vs-xp/30 bg-vs-xp-soft p-3 text-center ${compact ? "min-h-24" : "min-h-28"}`}>
      <AchievementIcon slug={achievement.slug} fallbackIcon={achievement.icon} className="h-9 w-9" />
      <span className="text-xs font-bold leading-snug text-vs-fg">{name}</span>
      <span className="sr-only">{t("profile.achievementEarned")}. {description}</span>
    </div>
  );
}

function FeaturedAchievementsManager({ achievements, initialIds, onSave }: { achievements: AchievementView[]; initialIds: string[]; onSave: (ids: string[]) => Promise<void> }) {
  const t = useT();
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const earned = achievements.filter((achievement) => achievement.earnedAt);
  const selected = selectedIds.map((id) => earned.find((achievement) => achievement.id === id)).filter((achievement): achievement is AchievementView => Boolean(achievement));
  const hasChanges = selectedIds.join("|") !== initialIds.join("|");

  function remove(id: string) {
    setSelectedIds((current) => current.filter((value) => value !== id));
  }

  function move(id: string, direction: -1 | 1) {
    setSelectedIds((current) => {
      const from = current.indexOf(id);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(selectedIds);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("wordOfTheDay.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileCard title={t("profile.featuredAchievements")} description={t("profile.featuredAchievementsHint")}>
      <p className="mt-3 text-sm font-bold text-vs-fg-2">{t("profile.featuredAchievementsCount", { selected: selected.length, max: 5 })}</p>
      {selected.length > 0 && (
        <SortableList
          items={selected}
          onReorder={(next) => setSelectedIds(next.map((achievement) => achievement.id))}
          getItemLabel={(achievement) => translateOr(t, `achievements.${achievement.slug}.name`, achievement.name)}
          dndId="featured-achievements"
          className="mt-3 flex flex-col gap-2"
          renderItem={(achievement, handle) => {
            const index = selectedIds.indexOf(achievement.id);
            const label = translateOr(t, `achievements.${achievement.slug}.name`, achievement.name);
            return (
              <div className="flex min-h-14 items-center gap-2 rounded-xl border border-vs-line bg-vs-surface p-2">
                <DragHandle {...handle} />
                <AchievementIcon slug={achievement.slug} fallbackIcon={achievement.icon} className="h-7 w-7" />
                <span className="min-w-0 flex-1 truncate font-bold text-vs-fg">{label}</span>
                {!handle.isOverlay && <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" onClick={() => move(achievement.id, -1)} disabled={index === 0} aria-label={t("cards.moveUp")} className="flex h-10 w-10 items-center justify-center rounded-lg text-vs-fg-2 hover:bg-vs-subtle disabled:opacity-35"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                  <button type="button" onClick={() => move(achievement.id, 1)} disabled={index === selected.length - 1} aria-label={t("cards.moveDown")} className="flex h-10 w-10 items-center justify-center rounded-lg text-vs-fg-2 hover:bg-vs-subtle disabled:opacity-35"><ArrowDown className="h-4 w-4" aria-hidden /></button>
                  <button type="button" onClick={() => remove(achievement.id)} aria-label={t("profile.removeFeaturedAchievement", { name: label })} className="flex h-10 w-10 items-center justify-center rounded-lg text-vs-danger hover:bg-vs-danger-soft"><X className="h-4 w-4" aria-hidden /></button>
                </div>}
              </div>
            );
          }}
        />
      )}
      {earned.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {earned.filter((achievement) => !selectedIds.includes(achievement.id)).map((achievement) => {
            const label = translateOr(t, `achievements.${achievement.slug}.name`, achievement.name);
            return (
              <button key={achievement.id} type="button" disabled={selected.length >= 5} onClick={() => setSelectedIds((current) => [...current, achievement.id])} className="flex min-h-12 items-center gap-2 rounded-xl border border-vs-line px-3 text-left transition hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent disabled:cursor-not-allowed disabled:opacity-45">
                <AchievementIcon slug={achievement.slug} fallbackIcon={achievement.icon} className="h-6 w-6" />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-vs-fg">{label}</span>
                <Plus className="h-4 w-4 shrink-0 text-vs-accent" aria-hidden />
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SettingsButton onClick={save} disabled={saving || !hasChanges}>{saving ? t("courses.busy") : t("profile.saveFeaturedAchievements")}</SettingsButton>
        {error && <SettingsStatus kind="error">{error}</SettingsStatus>}
      </div>
    </ProfileCard>
  );
}

export function AchievementsView({ data, onSaveFeatured }: { data: ProfileData; onSaveFeatured: (ids: string[]) => Promise<void> }) {
  const t = useT();
  const total = data.achievements.length;
  const earned = data.achievements.filter((a) => a.earnedAt).length;
  const percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  return (
    <>
      <FeaturedAchievementsManager key={data.featuredAchievementIds.join("|")} achievements={data.achievements} initialIds={data.featuredAchievementIds} onSave={onSaveFeatured} />
      {data.featuredAchievementIds.length > 0 && (
        <ProfileCard title={t("profile.yourFeaturedAchievements")}>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.featuredAchievementIds.map((id) => data.achievements.find((achievement) => achievement.id === id)).filter((achievement): achievement is AchievementView => Boolean(achievement)).map((achievement) => <AchievementTile key={achievement.id} achievement={achievement} compact />)}
          </div>
        </ProfileCard>
      )}
      <ProfileCard>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-extrabold text-vs-fg">{t("profile.earnedOf", { earned, total })}</p>
        <p className="text-sm font-bold text-vs-fg-2">{percent}%</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-vs-subtle" aria-hidden>
        <div className="h-full rounded-full bg-vs-xp-fill" style={{ width: `${percent}%` }} />
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {data.achievements.map((achievement) => {
          const done = Boolean(achievement.earnedAt);
          const name = translateOr(t, `achievements.${achievement.slug}.name`, achievement.name);
          const description = translateOr(t, `achievements.${achievement.slug}.description`, achievement.description);
          return (
            <li
              key={achievement.slug}
              title={description}
              className={`relative flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center ${
                done ? "border-vs-xp/30 bg-vs-xp-soft" : "border-vs-line bg-vs-subtle"
              }`}
            >
              {!done && <Lock className="absolute right-2 top-2 h-3.5 w-3.5 text-vs-fg-3" aria-hidden />}
              <AchievementIcon slug={achievement.slug} fallbackIcon={achievement.icon} className={`h-9 w-9 ${done ? "" : "opacity-40 grayscale"}`} />
              <span className={`text-xs font-bold leading-snug ${done ? "text-vs-fg" : "text-vs-fg-3"}`}>{name}</span>
              <span className="sr-only">
                {done ? t("profile.achievementEarned") : t("profile.achievementLocked")}. {description}
              </span>
            </li>
          );
        })}
      </ul>
      </ProfileCard>
    </>
  );
}
