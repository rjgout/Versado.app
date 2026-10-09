"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import LanguageSettings from "@/components/LanguageSettings";
import { useRouter, useSearchParams } from "next/navigation";
import type { LeagueTier } from "@/generated/prisma/client";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import { formatTag } from "@/lib/handle";
import { enableBrowserPush, disableBrowserPush } from "@/lib/pushClient";
import { getSocket } from "@/lib/socketClient";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { invalidateData } from "@/lib/data/client";
import { startCountdown } from "@/lib/countdown";
import ThemePreference from "@/components/ThemePreference";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/timeZone";
import TwoFactorSettings from "@/components/TwoFactorSettings";
import { getDutchVoices, saveSelectedDutchVoice } from "@/lib/readAloud";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import ProfileCharacterHero from "@/components/ProfileCharacterHero";
import { getLanguage } from "@/lib/languages";
import SystemIcon from "@/components/versado/SystemIcon";
import CompanionPicker, { companionName } from "@/components/versado/CompanionPicker";
import { useCompanion } from "@/components/versado/PersonalMascot";
import type { PersonalMascotCharacter } from "@/lib/mascots";
import { parseProfileView, profileViewHref, PROFILE_VIEWS, type ProfileView } from "@/lib/profileViews";
import ProfilePage from "@/components/profile/ProfilePage";
import KompasEntryCard from "@/components/kompas/KompasEntryCard";
import { KompasIcon } from "@/components/kompas/KompasIcon";
import { ProfileCard, SettingsButton, SettingsInfoRow, SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/profile/settings";
import { AchievementsView, CompetitionView } from "@/components/profile/ProfileContentViews";
import { NotificationsView, PresenceView, PrivacyView, ReadAloudView, ReadingView, WhatsNewView } from "@/components/profile/ProfileSettingsViews";
import type { ProfileData, ProfileToggleField } from "@/components/profile/profileData";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Clock,
  ChevronRight,
  Globe2,
  KeyRound,
  LockKeyhole,
  LogOut,
  MessageSquare,
  Pencil,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  SunMoon,
  Trash2,
  Trophy,
  Users,
  Volume2,
} from "lucide-react";

// Het profiel: overzicht op /profile en elk onderdeel op /profile?view=...
// (src/lib/profileViews.ts). Gegevens en opslaan staan hier, de weergave
// van de onderdelen in src/components/profile/. Alles binnen ProfilePage en
// met de gedeelde componenten uit profile/settings.tsx: zie docs/PROFIEL.md.

export default function ProfileClient() {
  const t = useT();
  const confirm = useConfirm();
  const tier = (value: LeagueTier) => t(`tiers.${value}`);
  // Profielgegevens, statistieken, XP, reeks en badges veranderen door activiteiten elders: de live-data-laag
  // ververst ze bij openen, terugnavigeren, focus en na XP-/activiteitsgebeurtenissen (scope profile, xp,
  // streak en competition). Eigen instellingen zetten we direct lokaal (setData) en valideren we daarna.
  const profile = useLiveQuery<ProfileData>(["profile", "me"], () => fetchJson<ProfileData>("/api/profile"), {
    scopes: ["profile", "xp", "streak", "competition"],
  });
  const data = profile.data ?? null;
  const setData = profile.setData;
  const [deleting, setDeleting] = useState(false);
  const [resettingReadingProgress, setResettingReadingProgress] = useState(false);
  const [resetReadingMessage, setResetReadingMessage] = useState<string | null>(null);
  const [resetReadingError, setResetReadingError] = useState<string | null>(null);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [testingPush, setTestingPush] = useState(false);
  const [pushTestMessage, setPushTestMessage] = useState<string | null>(null);
  const [pushCountdown, setPushCountdown] = useState<number | null>(null);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [readAloudVoices, setReadAloudVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedReadAloudVoice, setSelectedReadAloudVoice] = useState("");
  const [testingReadAloudVoice, setTestingReadAloudVoice] = useState(false);
  const [readAloudSpeed, setReadAloudSpeed] = useState(1);
  const router = useRouter();
  // Elk onderdeel heeft een eigen adres (zie src/lib/profileViews.ts); de
  // kop met terugpijl staat in de terugbalk (SubpageBackBar).
  const view = parseProfileView(useSearchParams().get("view"));

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const loadVoices = () => {
      setReadAloudVoices(getDutchVoices());
      setSelectedReadAloudVoice(window.localStorage.getItem("jehovaapp-read-aloud-voice") ?? "");
    };

    loadVoices();
    const savedSpeed = window.localStorage.getItem("jehovaapp-read-aloud-speed");
    if (savedSpeed) setReadAloudSpeed(Number(savedSpeed));
    window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", loadVoices);
    };
  }, []);

  async function toggleSearchableByEmail() {
    if (!data) return;
    const next = !data.searchableByEmail;
    setData({ ...data, searchableByEmail: next });
    setSavingPrivacy(true);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchableByEmail: next }),
    }).catch(() => {});
    afterAccountChange();
    setSavingPrivacy(false);
  }

  async function toggleShareAchievements() {
    if (!data) return;
    const next = !data.shareAchievements;
    setData({ ...data, shareAchievements: next });
    setSavingPrivacy(true);
    await saveAccountPatch({ shareAchievements: next });
    setSavingPrivacy(false);
    // Vrienden met dit profiel open halen na de serverwijziging vers op.
    getSocket().emit("friend_profile_changed");
  }

  async function saveFeaturedAchievements(achievementIds: string[]) {
    try {
      await liveMutation(
        () => fetchJson("/api/profile/featured-achievements", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ achievementIds }) }),
        { invalidates: ["profile", "friends"] }
      );
      setData((current) => (current ? { ...current, featuredAchievementIds: achievementIds } : current));
      getSocket().emit("friend_profile_changed");
    } catch {
      // De beheerweergave laat de onopgeslagen keuze staan zodat iemand hem
      // opnieuw kan bewaren zonder zijn werk kwijt te raken.
      throw new Error(t("wordOfTheDay.somethingWrong"));
    }
  }

  // Het profiel zelf is al lokaal bijgewerkt (optimistisch), dus niet opnieuw ophalen; wel de schermen waar
  // deze instellingen doorwerken (Vandaag toont bv. begroeting, afteltimer en spelkaarten) als verouderd markeren.
  function afterAccountChange() {
    invalidateData(["today"]);
  }

  async function saveAccountPatch(patch: Record<string, boolean | string | number | null>) {
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
    afterAccountChange();
  }

  const [savingPresence, setSavingPresence] = useState(false);

  // De routehandler zelf kan vrienden niet live laten meekrijgen van een
  // wijziging (zie de toelichting bij /api/account/route.ts) — dit signaal
  // over de al bestaande socketverbinding bereikt wél de instantie die de
  // echte Socket.io-server draait.
  function notifyPresenceSettingsChanged() {
    getSocket().emit("presence_settings_changed");
  }

  async function toggleShareOnlineStatus() {
    if (!data) return;
    const next = !data.shareOnlineStatus;
    // Activiteit delen zonder online-status delen is zinloos (je ziet
    // toch nooit de groene stip) — dus gelijk meenemen als je online-status
    // uitzet, zodat de instellingen nooit tegenstrijdig blijven staan.
    setData({ ...data, shareOnlineStatus: next, shareCurrentActivity: next ? data.shareCurrentActivity : false });
    setSavingPresence(true);
    await saveAccountPatch(next ? { shareOnlineStatus: next } : { shareOnlineStatus: next, shareCurrentActivity: false });
    setSavingPresence(false);
    notifyPresenceSettingsChanged();
  }

  async function toggleShareCurrentActivity() {
    if (!data || !data.shareOnlineStatus) return;
    const next = !data.shareCurrentActivity;
    setData({ ...data, shareCurrentActivity: next });
    setSavingPresence(true);
    await saveAccountPatch({ shareCurrentActivity: next });
    setSavingPresence(false);
    notifyPresenceSettingsChanged();
  }

  async function activateIncognito(hours: 1 | 4 | 12 | 24) {
    if (!data) return;
    setData({ ...data, incognitoActive: true });
    setSavingPresence(true);
    await saveAccountPatch({ incognitoHours: hours });
    setSavingPresence(false);
    notifyPresenceSettingsChanged();
  }

  async function deactivateIncognito() {
    if (!data) return;
    setData({ ...data, incognitoActive: false });
    setSavingPresence(true);
    await saveAccountPatch({ incognitoHours: null });
    setSavingPresence(false);
    notifyPresenceSettingsChanged();
  }

  async function toggleEmailNotifications() {
    if (!data) return;
    const next = !data.emailNotificationsEnabled;
    setData({ ...data, emailNotificationsEnabled: next });
    setSavingNotifications(true);
    await saveAccountPatch({ emailNotificationsEnabled: next });
    setSavingNotifications(false);
  }

  async function togglePushNotifications() {
    if (!data) return;
    setPushError(null);
    const next = !data.pushNotificationsEnabled;
    setSavingNotifications(true);
    try {
      if (next) {
        await enableBrowserPush();
      } else {
        await disableBrowserPush();
      }
      setData({ ...data, pushNotificationsEnabled: next });
      await saveAccountPatch({ pushNotificationsEnabled: next });
    } catch (e) {
      setPushError(e instanceof Error ? e.message : t("profile.pushToggleFailed"));
    }
    setSavingNotifications(false);
  }

  async function sendTestPush() {
    setTestingPush(true);
    setPushTestMessage(null);
    const res = await fetch("/api/push/test", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTestingPush(false);
      setPushTestMessage(body.error ?? t("profile.testPushFailed"));
      return;
    }

    // Aftellen tot de server de melding verstuurt; sluit de app in de
    // tussentijd om ook de badge op het app-icoon te kunnen zien.
    startCountdown(
      body.delaySeconds ?? 5,
      (remaining) => setPushCountdown(remaining),
      () => {
        setPushCountdown(null);
        setTestingPush(false);
        setPushTestMessage(t("profile.testPushSent"));
      }
    );
  }

  async function resetReadingProgress() {
    if (!(await confirm(t("profile.readingResetConfirm"), { title: t("profile.readingReset"), confirmLabel: t("profile.readingReset"), destructive: true }))) return;
    setResettingReadingProgress(true);
    setResetReadingError(null);
    try {
      // Leesvoortgang hoort bij de inhoud: cursussen, voortgang, Vandaag en de profielstatistieken kloppen daarna niet meer.
      await liveMutation(() => fetchJson("/api/progress/reset-reading", { method: "POST" }), { invalidates: ["progress", "courses", "profile", "today"] });
      setResettingReadingProgress(false);
      setResetReadingMessage(t("profile.readingResetDone"));
    } catch {
      setResettingReadingProgress(false);
      setResetReadingError(t("wordOfTheDay.somethingWrong"));
    }
  }

  async function changeReminderTime(time: string) {
    if (!data) return;
    setData({ ...data, dailyReminderTime: time });
    await saveAccountPatch({ dailyReminderTime: time });
  }

  async function toggleCategory(field: ProfileToggleField) {
    if (!data) return;
    const next = !data[field];
    setData({ ...data, [field]: next });
    setSavingNotifications(true);
    await saveAccountPatch({ [field]: next });
    setSavingNotifications(false);
  }

  async function togglePodcastNotifications(podcastId: string) {
    if (!data) return;
    const podcast = data.podcastNotifications.find((item) => item.podcastId === podcastId);
    if (!podcast) return;
    const enabled = !podcast.enabled;
    setData({ ...data, podcastNotifications: data.podcastNotifications.map((item) => item.podcastId === podcastId ? { ...item, enabled } : item) });
    setSavingNotifications(true);
    try {
      await liveMutation(
        () => fetchJson(`/api/podcast-notifications/${encodeURIComponent(podcastId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }),
        { invalidates: "settingsChanged" }
      );
    } catch {
      setData(data);
    } finally {
      setSavingNotifications(false);
    }
  }

  function startEditingHandle() {
    if (!data) return;
    setHandleInput(data.handle);
    setHandleError(null);
    setEditingHandle(true);
  }

  async function saveHandle() {
    if (!data) return;
    setSavingHandle(true);
    setHandleError(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: handleInput }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingHandle(false);
    if (!res.ok) {
      setHandleError(body.error ?? t("profile.handleSaveFailed"));
      return;
    }
    // Het nummer erachter kies je niet zelf — het systeem behoudt je huidige
    // nummer waar mogelijk, of loot een nieuwe bij een botsing (zie
    // /api/account). Hier gewoon overnemen wat de server teruggeeft.
    setData({ ...data, handle: body.handle, discriminator: body.discriminator });
    // Je naam staat ook op Vandaag, in klassementen en in de activiteit van vrienden.
    invalidateData(["today", "competition", "activity"]);
    setEditingHandle(false);
  }

  function changeReadAloudSpeed(nextSpeed: number) {
    setReadAloudSpeed(nextSpeed);
    window.localStorage.setItem("jehovaapp-read-aloud-speed", String(nextSpeed));
  }

  function changeReadAloudVoice(voiceUri: string) {
    setSelectedReadAloudVoice(voiceUri);
    saveSelectedDutchVoice(voiceUri || null);
  }

  function testReadAloudVoice() {
    if (!("speechSynthesis" in window) || readAloudVoices.length === 0) return;

    const synth = window.speechSynthesis;

    const voice = readAloudVoices.find((item) => item.voiceURI === selectedReadAloudVoice) ?? readAloudVoices[0];
    const utterance = new SpeechSynthesisUtterance(
      t("profile.voiceSample")
    );
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = readAloudSpeed;
    utterance.onstart = () => setTestingReadAloudVoice(true);
    utterance.onend = () => setTestingReadAloudVoice(false);
    utterance.onerror = () => setTestingReadAloudVoice(false);

    setTestingReadAloudVoice(true);
    synth.speak(utterance);
  }

  // Bevestigen via de gedeelde dialoog (ConfirmProvider), niet met een blok
  // dat in de pagina openklapt.
  async function logout() {
    if (!(await confirm(t("profile.logoutConfirm"), { title: t("profile.logout"), confirmLabel: t("profile.logoutYes") }))) return;
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function deleteAccount() {
    if (!(await confirm(t("profile.deleteWarning"), { title: t("profile.deleteAccount"), confirmLabel: t("profile.deleteConfirm"), destructive: true }))) return;
    setDeleting(true);
    const res = await fetch("/api/account", { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setDeleting(false);
    }
  }

  if (!data) {
    return (
      <ProfilePage>
        <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>
      </ProfilePage>
    );
  }

  const earnedCount = data.achievements.filter((a) => a.earnedAt).length;
  // Een gewone pushState in plaats van router.push: Next.js houdt dan
  // useSearchParams bij zonder de pagina opnieuw te laden, zodat het
  // overzicht bij terug meteen (en op dezelfde hoogte) weer klaarstaat.
  function openView(next: ProfileView) {
    window.history.pushState(null, "", profileViewHref(next));
  }

  if (view) {
    return (
      <ProfilePage title={t(PROFILE_VIEWS[view].title)}>
        {view === "competition" && <CompetitionView data={data} />}
        {view === "achievements" && <AchievementsView data={data} onSaveFeatured={saveFeaturedAchievements} />}
        {view === "reading" && <ReadingView resetting={resettingReadingProgress} message={resetReadingMessage} error={resetReadingError} onReset={resetReadingProgress} />}
        {view === "language" && <LanguageSettings uiLanguage={data.uiLanguage} isAdmin={data.isAdmin} />}
        {view === "readAloud" && <ReadAloudView voices={readAloudVoices} selectedVoice={selectedReadAloudVoice} speed={readAloudSpeed} testing={testingReadAloudVoice} onVoice={changeReadAloudVoice} onSpeed={changeReadAloudSpeed} onTest={testReadAloudVoice} />}
        {view === "notifications" && <NotificationsView data={data} saving={savingNotifications} pushError={pushError} testingPush={testingPush} pushCountdown={pushCountdown} pushTestMessage={pushTestMessage} onEmail={toggleEmailNotifications} onPush={togglePushNotifications} onTest={sendTestPush} onCategory={toggleCategory} onReminder={changeReminderTime} onDailyText={(time) => saveAccountPatch({ dailyTextTime: time }).then(() => setData((current) => current ? { ...current, dailyTextTime: time } : current))} onPodcast={togglePodcastNotifications} />}
        {view === "privacy" && <PrivacyView data={data} saving={savingPrivacy} onToggleSearchable={toggleSearchableByEmail} onToggleAchievements={toggleShareAchievements} />}
        {view === "presence" && <PresenceView data={data} saving={savingPresence} onOnline={toggleShareOnlineStatus} onActivity={toggleShareCurrentActivity} onIncognito={activateIncognito} onIncognitoOff={deactivateIncognito} />}
        {view === "about" && <WhatsNewView enabled={data.changelogEnabled} saving={savingNotifications} onToggle={() => toggleCategory("changelogEnabled")} />}
        {view === "twoFactor" && <TwoFactorSettings isAdmin={data.isAdmin} />}
      </ProfilePage>
    );
  }

  return (
    <ProfilePage>
      {data.isAdmin && <Link href="/adminbackend" className="flex items-center gap-2 rounded-xl border border-vs-line bg-vs-surface px-4 py-3 text-sm font-bold text-vs-accent transition hover:bg-vs-subtle"><ShieldCheck className="h-5 w-5" aria-hidden />{t("profile.toAdmin")}</Link>}

      <section className="overflow-hidden rounded-3xl border border-vs-line bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm dark:from-brand-600 dark:to-brand-900">
        <ProfileCharacterHero
          appearance={{ avatarEmoji: data.avatarEmoji, avatarCharacterId: data.avatarCharacterId, avatarBackgroundId: data.avatarBackgroundId, avatarFrameId: data.avatarFrameId, avatarDecorationId: data.avatarDecorationId, avatarLightAccentId: data.avatarLightAccentId }}
          handle={data.handle}
          zoomInLabel={t("profile.zoomIn")}
          zoomOutLabel={t("profile.zoomOut")}
          changeLabel={t("profile.changeAvatar")}
          changeHref="/profile/avatar"
        />
        <div className="p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {!editingHandle ? <>
                <h1 className="flex min-w-0 items-center gap-1.5 text-xl font-extrabold"><span className="truncate">{data.displayName}</span><button type="button" onClick={startEditingHandle} className="shrink-0 opacity-80 hover:opacity-100" title={t("profile.changeHandle")} aria-label={t("profile.changeHandle")}><Pencil className="h-4 w-4" aria-hidden /></button></h1>
                <p className="truncate text-sm text-brand-100">{formatTag(data.handle, data.discriminator)}</p>
              </> : <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2"><input className="input !w-auto !py-1 !text-sm" value={handleInput} onChange={(event) => setHandleInput(event.target.value)} maxLength={24} autoFocus aria-label={t("profile.changeHandle")} /><span className="text-sm text-brand-100">#{data.discriminator}</span></label>
                {handleError && <p className="text-xs text-red-100">{handleError}</p>}
                <div className="flex gap-2"><button className="btn-primary !px-3 !py-1 !text-xs" disabled={savingHandle} onClick={saveHandle}>{savingHandle ? t("courses.busy") : t("profile.save")}</button><button className="btn-secondary !px-3 !py-1 !text-xs" onClick={() => setEditingHandle(false)}>{t("activeGames.cancel")}</button></div>
              </div>}
            </div>
            {data.tier && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/15 py-1 pl-1.5 pr-3 text-sm font-bold text-gold-400"><DivisionEmblem tier={data.tier} className="h-7 w-7" />{tier(data.tier)}</span>}
          </div>
        <div className="mt-5 grid grid-cols-4 divide-x divide-white/15 rounded-2xl bg-black/10 py-2">
          <CompactHeroStat value={<><SystemIcon kind="streak" className="h-4 w-4" fill="currentColor" aria-hidden /> {data.currentStreak}</>} label={t("profile.streak")} href="/streak" />
          <CompactHeroStat value={<><SystemIcon kind="xp" className="h-4 w-4" fill="currentColor" aria-hidden /> {data.xpTotal}</>} label="XP" href="/xp" />
          <CompactHeroStat value={<><SystemIcon kind="freeze" className="h-4 w-4" aria-hidden /> {data.freezeCount}</>} label={t("lesson.freezes")} />
          <CompactHeroStat value={<><BookOpen className="h-4 w-4" aria-hidden /> {data.chaptersCompleted}</>} label={t("profile.chaptersShort")} />
        </div>
        </div>
      </section>

      {/* Acties direct onder de statistieken. Dit is de enige ingang naar
          de winkel; feedback staat er bewust naast. */}
      <div className="grid grid-cols-2 gap-3">
        <ProfileAction icon={<ShoppingBag className="h-5 w-5 text-vs-xp" aria-hidden />} label={t("nav.shop")} href="/shop" />
        <ProfileAction icon={<MessageSquare className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("pages.feedback")} href="/feedback" />
      </div>

      <KompasEntryCard />

      <CompanionSection
        current={data.companion}
        onChanged={(companion) => setData((current) => (current ? { ...current, companion } : current))}
      />

      <ProfileCard title={<><Trophy className="h-5 w-5 text-vs-xp" aria-hidden />{t("nav.competition")}</>}>
        {/* Smal scherm: beste divisie onder de huidige, anders breekt de
            huidige divisie af in losse woorden. */}
        <button type="button" onClick={() => openView("competition")} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">
          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="flex min-w-0 items-center gap-3">{data.tier && <DivisionEmblem tier={data.tier} className="h-12 w-12" />}<span className="min-w-0"><span className="block font-bold text-vs-fg">{data.tier ? tier(data.tier) : "—"}</span><span className="block text-sm text-vs-fg-2">{data.groupPosition ? `#${data.groupPosition} · ` : ""}{t("profile.thisWeek")}</span></span></span>
            <span className="text-sm font-bold text-vs-fg-2">{data.bestTierEver ? `${t("profile.bestTier")}: ${tier(data.bestTierEver)}` : "—"}</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />
        </button>
      </ProfileCard>

      <SettingsSection title={t("profile.progressSection")}>
        <SettingsRow icon={<Trophy className="h-5 w-5 text-vs-xp" aria-hidden />} label={t("profile.achievements")} value={`${earnedCount}/${data.achievements.length}`} onClick={() => openView("achievements")} />
        <SettingsRow icon={<BookOpen className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.readingProgress")} value={`${data.chaptersCompleted} ${t("profile.chapters").toLowerCase()}`} onClick={() => openView("reading")} />
      </SettingsSection>

      <SettingsSection title={t("profile.preferencesSection")}>
        {/* Weergave direct hier te kiezen: één tik, en je ziet meteen wat aan staat. */}
        <div className="flex flex-col gap-2 px-2 py-3 sm:flex-row sm:items-center sm:gap-3">
          <span className="flex min-w-0 flex-1 items-center gap-3"><SunMoon className="h-5 w-5 shrink-0 text-vs-accent" aria-hidden /><span className="truncate font-bold text-vs-fg">{t("theme.appearance")}</span></span>
          <div className="sm:w-80"><ThemePreference /></div>
        </div>
        <SettingsRow icon={<Globe2 className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("languageSettings.title")} value={getLanguage(data.uiLanguage).nativeName} onClick={() => openView("language")} />
        <SettingsRow icon={<Volume2 className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.readAloud")} onClick={() => openView("readAloud")} />
        <SettingsRow icon={<Bell className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.notifications")} onClick={() => openView("notifications")} />
        <SettingsRow icon={<Users className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.onlineActivity")} value={data.shareOnlineStatus ? t("twoFactor.on") : t("twoFactor.off")} onClick={() => openView("presence")} />
        <SettingsRow icon={<LockKeyhole className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.privacy")} onClick={() => openView("privacy")} />
        <TimeZoneRow known={data.timeZone} label={t("profile.timeZone")} format={(zone) => t("profile.timeZoneAuto", { zone })} locale={getLanguage(data.uiLanguage).intlLocale} />
        <SettingsToggleRow icon={<CalendarDays className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.conferenceCountdown")} description={t("profile.conferenceCountdownHint")} checked={data.conferenceCountdownEnabled} busy={savingNotifications} onChange={() => toggleCategory("conferenceCountdownEnabled")} />
        <SettingsToggleRow icon={<KompasIcon className="h-5 w-5 text-vs-accent" />} label={t("kompas.settings.offersTitle")} description={t("kompas.settings.offersHint")} checked={data.kompasOffersEnabled} busy={savingNotifications} onChange={() => toggleCategory("kompasOffersEnabled")} />
      </SettingsSection>

      <SettingsSection title={t("profile.aboutSection")}>
        <SettingsRow icon={<Sparkles className="h-5 w-5 text-vs-xp" aria-hidden />} label={t("profile.whatsNew")} onClick={() => openView("about")} />
        <SettingsRow icon={<KompasIcon className="h-5 w-5 text-vs-accent" />} label={t("kompas.entry.title")} href="/kompas" />
      </SettingsSection>

      <SettingsSection title={t("profile.accountSecuritySection")}>
        <SettingsRow icon={<ShieldCheck className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.twoFactor")} value={data.totpEnabled ? t("twoFactor.on") : t("twoFactor.off")} onClick={() => openView("twoFactor")} />
        <SettingsRow icon={<KeyRound className="h-5 w-5 text-vs-fg-2" aria-hidden />} label={t("profile.changePassword")} href="/change-password" />
        <SettingsRow icon={<LogOut className="h-5 w-5 text-vs-fg-2" aria-hidden />} label={t("profile.logout")} onClick={logout} />
      </SettingsSection>

      {/* Bewust geen gewone rij: verwijderen hoort niet tussen de dagelijkse
          instellingen te concurreren. Bevestigen gaat via de dialoog. */}
      <SettingsButton variant="quietDanger" className="self-center" disabled={deleting} onClick={deleteAccount}>
        <Trash2 className="h-4 w-4" aria-hidden />
        {deleting ? t("courses.busy") : t("profile.deleteAccount")}
      </SettingsButton>
    </ProfilePage>
  );
}

// Ter informatie, geen instelling: de tijdzone volgt automatisch het toestel
// (TimeZoneSync.tsx). Intern altijd de IANA-naam; zichtbaar de gangbare
// naam in de taal van de app, met de IANA-naam eronder.
function TimeZoneRow({ known, label, format, locale }: { known: string | null; label: string; format: (zone: string) => string; locale: string }) {
  const [zone, setZone] = useState(known ?? DEFAULT_TIME_ZONE);
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidTimeZone(detected)) setZone(detected);
    } catch {
      // geen Intl-tijdzone: de opgeslagen blijft staan
    }
  }, []);
  let name = zone;
  try {
    name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch {
    // oudere browser zonder longGeneric: de IANA-naam
  }
  return (
    <SettingsInfoRow
      icon={<Clock className="h-5 w-5 text-vs-accent" aria-hidden />}
      label={label}
      description={<>{format(name)}<span className="block text-xs text-vs-fg-3">{zone.replace(/_/g, " ")}</span></>}
    />
  );
}

function ProfileAction({ icon, label, href }: { icon: ReactNode; label: string; href: string }) {
  return <Link href={href} className="bg-vs-surface flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-2xl border border-vs-line px-3 font-bold text-vs-fg transition hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"><span className="shrink-0">{icon}</span><span className="min-w-0 truncate">{label}</span></Link>;
}

function CompactHeroStat({ value, label, href }: { value: ReactNode; label: string; href?: string }) {
  const content = <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center"><div className="flex items-center gap-1 text-sm font-extrabold text-white">{value}</div><div className="whitespace-nowrap text-[0.625rem] font-bold uppercase leading-tight text-brand-100">{label}</div></div>;
  return href ? <Link href={href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">{content}</Link> : content;
}

/**
 * Jouw gids: dezelfde keuze als bij de onboarding. Opslaan gebeurt meteen;
 * pas na een bevestigd antwoord wisselt de gids in de hele app (useCompanion),
 * zodat het scherm nooit een keuze toont die niet is opgeslagen.
 */
function CompanionSection({ current, onChanged }: { current: PersonalMascotCharacter; onChanged: (companion: PersonalMascotCharacter) => void }) {
  const t = useT();
  const { setCharacter } = useCompanion();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);

  async function choose(choice: PersonalMascotCharacter) {
    if (choice === current || saving) return;
    setSaving(true);
    setStatus(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companion: choice }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setStatus({ kind: "error", text: t("companion.saveFailed") });
      return;
    }
    setCharacter(choice);
    onChanged(choice);
    invalidateData(["today"]);
    setStatus({ kind: "saved", text: t("companion.saved", { name: companionName(choice) }) });
  }

  return (
    <ProfileCard title={t("companion.profileTitle")} description={t("companion.profileIntro")}>
      <div className="mt-1">
        <CompanionPicker name="profile-companion" legend={t("companion.profileTitle")} value={current} onSelect={choose} disabled={saving} size="compact" />
      </div>
      <p role="status" className={`mt-3 min-h-5 text-sm font-semibold ${status?.kind === "error" ? "text-vs-danger" : "text-vs-success"}`}>
        {status?.text}
      </p>
    </ProfileCard>
  );
}
