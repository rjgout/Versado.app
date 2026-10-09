"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LockKeyhole, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import ProfilePage from "@/components/profile/ProfilePage";
import ScriptureAvatar from "@/components/ScriptureAvatar";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { avatarOptions, accessoryOptions } from "@/lib/avatarUnlocks";
import { getCharacterAsset } from "@/lib/characterAssets";
import { setAvatarAppearance } from "@/components/UserAvatar";
import { avatarAppearancePatch, avatarAppearancesEqual, filterAvatarOptions, type AvatarCharacterFilter } from "@/lib/avatarEditor";
import type { AvatarAppearance } from "@/lib/avatarTypes";
import type { AvatarAccessoryKind } from "@/lib/avatarAccessories";
import type { ProfileData } from "@/components/profile/profileData";

type EditorTab = "characters" | "accessories";

const ACCESSORY_SLOTS = [
  { kind: "background" as const, field: "avatarBackgroundId" as const },
  { kind: "frame" as const, field: "avatarFrameId" as const },
  { kind: "decoration" as const, field: "avatarDecorationId" as const },
  { kind: "lightAccent" as const, field: "avatarLightAccentId" as const },
];

export default function AvatarEditorClient() {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const profile = useLiveQuery<ProfileData>(["profile", "me"], () => fetchJson<ProfileData>("/api/profile"), {
    scopes: ["profile", "xp", "streak", "competition"],
  });
  const data = profile.data;
  const [savedAppearance, setSavedAppearance] = useState<AvatarAppearance | null>(null);
  const [draft, setDraft] = useState<AvatarAppearance | null>(null);
  const [tab, setTab] = useState<EditorTab>("characters");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AvatarCharacterFilter>("all");
  const [previewCompact, setPreviewCompact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowNavigation = useRef(false);
  const previewSentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data || savedAppearance) return;
    const appearance = appearanceFromProfile(data);
    // De API-data komt asynchroon binnen; daarna moet de lokale editor één
    // keer een bewerkbare snapshot krijgen zonder latere drafts te overschrijven.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedAppearance(appearance);
    setDraft(appearance);
  }, [data, savedAppearance]);

  const dirty = savedAppearance !== null && draft !== null && !avatarAppearancesEqual(savedAppearance, draft);
  const earnedAchievementSlugs = useMemo(
    () => data?.achievements.filter((achievement) => achievement.earnedAt).map((achievement) => achievement.slug) ?? [],
    [data],
  );
  const characters = useMemo(
    () => filterAvatarOptions(avatarOptions(earnedAchievementSlugs).filter((option) => getCharacterAsset(option.id)?.avatarAllowed), query, filter),
    [earnedAchievementSlugs, filter, query],
  );
  const accessories = useMemo(() => accessoryOptions(earnedAchievementSlugs), [earnedAchievementSlugs]);

  useEffect(() => {
    const node = previewSentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setPreviewCompact(!entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onPopState = () => {
      if (allowNavigation.current) return;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.history.pushState(null, "", current);
      void confirm(t("profile.avatarLeaveMessage"), {
        title: t("profile.avatarLeaveTitle"),
        confirmLabel: t("profile.avatarLeaveConfirm"),
      }).then((confirmed) => {
        if (!confirmed) return;
        allowNavigation.current = true;
        window.history.back();
      });
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (allowNavigation.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank" || target.download) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault();
      void confirm(t("profile.avatarLeaveMessage"), {
        title: t("profile.avatarLeaveTitle"),
        confirmLabel: t("profile.avatarLeaveConfirm"),
      }).then((confirmed) => {
        if (!confirmed) return;
        allowNavigation.current = true;
        router.push(`${url.pathname}${url.search}${url.hash}`);
      });
    };
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [confirm, dirty, router, t]);

  function selectCharacter(id: string) {
    const option = avatarOptions(earnedAchievementSlugs).find((item) => item.id === id);
    if (!option?.available || !getCharacterAsset(id)?.avatarAllowed) return;
    setDraft((current) => current ? { ...current, avatarCharacterId: id } : current);
  }

  function selectAccessory(kind: AvatarAccessoryKind, id: string | null) {
    const field = ACCESSORY_SLOTS.find((slot) => slot.kind === kind)?.field;
    if (!field) return;
    setDraft((current) => current ? { ...current, [field]: id } : current);
  }

  async function save() {
    if (!data || !savedAppearance || !draft || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const patch = avatarAppearancePatch(savedAppearance, draft);
      await liveMutation(
        () => fetchJson("/api/account", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
        { invalidates: ["profile", "friends", "today", "competition", "activity"] },
      );
      const next = { ...data, ...draft };
      profile.setData(next);
      setSavedAppearance(draft);
      setAvatarAppearance(data.id, draft);
      allowNavigation.current = true;
      router.push("/profile");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("profile.avatarSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!data || !draft) {
    return <ProfilePage title={t("profile.avatarEditorTitle")}><p className="text-sm text-vs-fg-3">{profile.error ? t("profile.avatarLoadFailed") : t("common.loading")}</p></ProfilePage>;
  }

  const achievementName = (slug: string | null) => data.achievements.find((achievement) => achievement.slug === slug)?.name ?? slug ?? t("profile.avatarUnavailable");
  const tabLabels: Record<EditorTab, string> = {
    characters: t("profile.avatarCharacters"),
    accessories: t("profile.avatarAccessories"),
  };
  const previewPosition = previewCompact ? "sticky top-[var(--header-offset)] z-10" : "relative z-0";

  return (
    <ProfilePage title={t("profile.avatarEditorTitle")}>
      <div className="pb-[calc(5.5rem+var(--vs-safe-area-bottom))]">
        <div ref={previewSentinel} className="h-px" aria-hidden="true" />
        <div className="relative h-[min(70vw,22rem)] min-h-64 -mx-1 sm:mx-0">
          <section className={`${previewPosition} pointer-events-none overflow-hidden rounded-3xl border border-vs-line bg-vs-surface shadow-sm transition-[height] duration-300 ease-out motion-reduce:transition-none ${previewCompact ? "h-24" : "h-full"}`} aria-labelledby="avatar-preview-title">
            <div className={`flex h-full items-center justify-center bg-vs-subtle transition-[transform] duration-300 ease-out motion-reduce:transition-none ${previewCompact ? "scale-75" : "scale-100"}`}>
              <ScriptureAvatar appearance={draft} handle={data.handle} label={t("profile.avatarPreview")} className={`aspect-square ${previewCompact ? "h-20 w-20 text-3xl" : "h-[min(62vw,18rem)] w-[min(62vw,18rem)] text-6xl"}`} />
            </div>
            <h2 id="avatar-preview-title" className="sr-only">{t("profile.avatarPreview")}</h2>
          </section>
        </div>

        <div className="mt-5 border-b border-vs-line" role="tablist" aria-label={t("profile.avatarEditorTitle")}>
          {(Object.keys(tabLabels) as EditorTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`avatar-panel-${key}`}
              id={`avatar-tab-${key}`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const keys = Object.keys(tabLabels) as EditorTab[];
                const index = keys.indexOf(key);
                const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length;
                setTab(keys[nextIndex]);
                document.getElementById(`avatar-tab-${keys[nextIndex]}`)?.focus();
              }}
              className={`min-h-12 flex-1 border-b-2 px-2 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vs-accent ${tab === key ? "border-vs-accent text-vs-accent" : "border-transparent text-vs-fg-2 hover:text-vs-fg"}`}
            >
              {tabLabels[key]}
            </button>
          ))}
        </div>

        {tab === "characters" && (
          <section id="avatar-panel-characters" role="tabpanel" aria-labelledby="avatar-tab-characters" className="mt-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t("profile.avatarSearch")}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-vs-fg-3" aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} className="input min-h-12 !pl-10" placeholder={t("profile.avatarSearch")} />
              </label>
              <label className="sm:w-48">
                <span className="sr-only">{t("profile.avatarFilter")}</span>
                <select value={filter} onChange={(event) => setFilter(event.target.value as AvatarCharacterFilter)} className="input min-h-12">
                  <option value="all">{t("profile.avatarFilterAll")}</option>
                  <option value="available">{t("profile.avatarFilterAvailable")}</option>
                  <option value="locked">{t("profile.avatarFilterLocked")}</option>
                  <option value="male">{t("profile.avatarFilterMale")}</option>
                  <option value="female">{t("profile.avatarFilterFemale")}</option>
                </select>
              </label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-live="polite">
              {characters.map((option) => {
                const selected = draft.avatarCharacterId === option.id;
                const character = getCharacterAsset(option.id);
                return (
                  <button key={option.id} type="button" disabled={!option.available || saving} onClick={() => selectCharacter(option.id)} aria-pressed={selected} aria-label={option.available ? option.name : `${option.name}: ${t("profile.avatarUnlockHint", { condition: achievementName(option.unlockAchievementSlug) })}`} className={`relative flex min-h-48 min-w-0 flex-col items-center justify-end overflow-hidden rounded-2xl border p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${selected ? "!border-vs-accent !bg-vs-accent-soft" : "border-vs-line bg-vs-surface hover:bg-vs-subtle"} ${!option.available ? "cursor-not-allowed opacity-75" : ""}`}>
                    {selected && <Check className="absolute right-2 top-2 z-10 h-5 w-5 rounded-full bg-vs-accent p-0.5 text-white" aria-hidden="true" />}
                    {!option.available && <LockKeyhole className="absolute left-2 top-2 z-10 h-5 w-5 text-vs-fg-2" aria-hidden="true" />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={character?.bustCompact ?? option.avatar} alt="" draggable={false} className={`h-32 w-full min-w-0 object-contain ${!option.available ? "grayscale" : ""}`} />
                    <span className="mt-1 min-w-0 max-w-full break-normal text-sm font-extrabold leading-tight text-vs-fg">{option.name}</span>
                    {!option.available && <span className="mt-1 max-w-full text-xs font-semibold leading-tight text-vs-fg-2">{option.unlockAchievementSlug ? achievementName(option.unlockAchievementSlug) : t("profile.avatarUnavailable")}</span>}
                  </button>
                );
              })}
            </div>
            {characters.length === 0 && <p className="mt-6 rounded-2xl border border-dashed border-vs-line p-6 text-center text-sm font-semibold text-vs-fg-2">{t("profile.avatarNoMatches")}</p>}
          </section>
        )}

        {tab === "accessories" && (
          <section id="avatar-panel-accessories" role="tabpanel" aria-labelledby="avatar-tab-accessories" className="mt-5 space-y-5">
            {ACCESSORY_SLOTS.map((slot) => {
              const current = draft[slot.field];
              const choices = accessories.filter((item) => item.kind === slot.kind);
              return (
                <section key={slot.kind} aria-labelledby={`avatar-slot-${slot.kind}`}>
                  <h2 id={`avatar-slot-${slot.kind}`} className="text-base font-extrabold text-vs-fg">{t(`profile.avatarSlot${slot.kind[0].toUpperCase()}${slot.kind.slice(1)}` as "profile.avatarSlotBackground")}</h2>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <button type="button" disabled={saving} onClick={() => selectAccessory(slot.kind, null)} aria-pressed={current === null} className={`flex min-h-32 flex-col items-center justify-center rounded-2xl border p-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${current === null ? "!border-vs-accent !bg-vs-accent-soft" : "border-vs-line bg-vs-surface hover:bg-vs-subtle"}`}>
                      <span className="text-2xl" aria-hidden="true">×</span>
                      {t("profile.avatarNone")}
                    </button>
                    {choices.map((item) => {
                      const selected = current === item.id;
                      const available = item.available;
                      const condition = item.achievementSlug ? achievementName(item.achievementSlug) : t("profile.avatarUnavailable");
                      return (
                        <button key={item.id} type="button" disabled={!available || saving} onClick={() => selectAccessory(slot.kind, item.id)} aria-pressed={selected} aria-label={available ? item.name : `${item.name}: ${t("profile.avatarUnlockHint", { condition })}`} className={`relative flex min-h-32 min-w-0 flex-col items-center justify-center rounded-2xl border p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${selected ? "!border-vs-accent !bg-vs-accent-soft" : "border-vs-line bg-vs-surface hover:bg-vs-subtle"} ${!available ? "cursor-not-allowed opacity-80" : ""}`}>
                          {selected && <Check className="absolute right-2 top-2 h-5 w-5 rounded-full bg-vs-accent p-0.5 text-white" aria-hidden="true" />}
                          {!available && <LockKeyhole className="absolute left-2 top-2 h-5 w-5 text-vs-fg-2" aria-hidden="true" />}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.compact} alt="" draggable={false} className={`h-20 w-20 object-contain ${!available ? "grayscale" : ""}`} />
                          <span className="mt-1 max-w-full break-normal text-sm font-extrabold leading-tight text-vs-fg">{item.name}</span>
                          {!available && <span className="mt-1 max-w-full text-xs font-semibold leading-tight text-vs-fg-2">{condition}</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </section>
        )}

        {error && <p className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm font-semibold text-red-700 dark:text-red-300" role="alert">{error}</p>}
      </div>

      <div data-avatar-editor-save-bar className="fixed inset-x-0 bottom-0 z-10 border-t border-vs-line bg-vs-surface/95 pb-[max(0.75rem,var(--vs-safe-area-bottom))] pt-3 shadow-[0_-4px_18px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-vs-surface/85">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-[max(1rem,var(--vs-safe-area-left))] pr-[max(1rem,var(--vs-safe-area-right))]">
          <p className="min-w-0 truncate text-sm font-semibold text-vs-fg-2">{dirty ? t("profile.avatarUnsaved") : t("profile.avatarNoChanges")}</p>
          <button type="button" className="btn-primary min-h-12 shrink-0 !px-6" disabled={!dirty || saving} onClick={save}>{saving ? t("courses.busy") : t("profile.save")}</button>
        </div>
      </div>
  </ProfilePage>
  );
}

function appearanceFromProfile(data: ProfileData): AvatarAppearance {
  return {
    avatarEmoji: data.avatarEmoji,
    avatarCharacterId: data.avatarCharacterId,
    avatarBackgroundId: data.avatarBackgroundId,
    avatarFrameId: data.avatarFrameId,
    avatarDecorationId: data.avatarDecorationId,
    avatarLightAccentId: data.avatarLightAccentId,
  };
}
