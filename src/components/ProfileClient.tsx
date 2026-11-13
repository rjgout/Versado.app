"use client";
import CompanionPreference from "@/components/profile/CompanionPreference";
import TimeZoneRow from "@/components/profile/TimeZoneRow";
import WhatsNewView from "@/components/profile/WebWhatsNewView";

import { useConfirm } from "@/components/ConfirmProvider";
import DorpEntry from "@/components/dorp/DorpEntry";
import { useT } from "@/components/I18nProvider";
import KompasEntryCard from "@/components/kompas/KompasEntryCard";
import LanguageSettings from "@/components/LanguageSettings";
import { AchievementsView,CompetitionView } from "@/components/profile/ProfileContentViews";
import type { ProfileData,ProfileToggleField } from "@/components/profile/profileData";
import ProfileOverview from "@/components/profile/ProfileOverview";
import ProfilePage from "@/components/profile/ProfilePage";
import { GameFeedbackView,NotificationsView,PresenceView,PrivacyView,ReadAloudView,ReadingView } from "@/components/profile/ProfileSettingsViews";
import TwoFactorSettings from "@/components/TwoFactorSettings";
import { startCountdown } from "@/lib/countdown";
import { invalidateData } from "@/lib/data/client";
import { fetchJson } from "@/lib/data/fetchJson";
import { useLiveQuery } from "@/lib/data/hooks";
import { jsonMutation,liveMutation } from "@/lib/data/mutation";
import { getLanguage } from "@/lib/languages";
import { parseProfileView,PROFILE_VIEWS,profileViewHref,type ProfileView } from "@/lib/profileViews";
import { disableBrowserPush,enableBrowserPush } from "@/lib/pushClient";
import { getDutchVoices,saveSelectedDutchVoice } from "@/lib/readAloud";
import { getSocket } from "@/lib/socketClient";
import { useRouter,useSearchParams } from "next/navigation";
import { useEffect,useState } from "react";

// Het profiel: overzicht op /profile en elk onderdeel op /profile?view=...
// (src/lib/profileViews.ts). Gegevens en opslaan staan hier, de weergave
// van de onderdelen in src/components/profile/. Alles binnen ProfilePage en
// met de gedeelde componenten uit profile/settings.tsx: zie docs/PROFIEL.md.

export default function ProfileClient() {
  const t = useT();
  const confirm = useConfirm();
  // Profielgegevens, statistieken, XP, reeks en badges veranderen door activiteiten elders: de live-data-laag
  // ververst ze bij openen, terugnavigeren, focus en na XP-/activiteitsgebeurtenissen (scope profile, xp,
  // streak en competition). Eigen instellingen zetten we direct lokaal (setData) en valideren we daarna.
  const profile = useLiveQuery<ProfileData>(["profile", "me"], () => fetchJson<ProfileData>("/api/profile"), {
    scopes: ["profile", "xp", "streak", "competition"],
  });
  const data = profile.data ?? null;
  const setData = profile.setData;
  const [resettingReadingProgress, setResettingReadingProgress] = useState(false);
  const [resetReadingMessage, setResetReadingMessage] = useState<string | null>(null);
  const [resetReadingError, setResetReadingError] = useState<string | null>(null);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [dailyTextSourceError, setDailyTextSourceError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [testingPush, setTestingPush] = useState(false);
  const [pushTestMessage, setPushTestMessage] = useState<string | null>(null);
  const [pushCountdown, setPushCountdown] = useState<number | null>(null);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);
  const [villagePrivacyError,setVillagePrivacyError]=useState<string|null>(null);
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

  async function toggleShareVillage() {
    if(!data||savingPrivacy)return;
    const next=!data.shareVillageWithFriends;
    setSavingPrivacy(true);setVillagePrivacyError(null);
    try{
      await jsonMutation("/api/account",{method:"PATCH",json:{shareVillageWithFriends:next}},{invalidates:["profile","dorp"]});
      setData(current=>current?{...current,shareVillageWithFriends:next}:current);
      getSocket().emit("friend_profile_changed");
    }catch(error){setVillagePrivacyError(error instanceof Error?error.message:t("apiErrors.notSaved"));}
    finally{setSavingPrivacy(false);}
  }

  async function toggleSharePuzzleRecords() {
    if (!data) return;
    const next = !data.sharePuzzleRecords;
    setData({ ...data, sharePuzzleRecords: next });
    setSavingPrivacy(true);
    await saveAccountPatch({ sharePuzzleRecords: next });
    setSavingPrivacy(false);
    // Vriendenranglijsten en vriendenprofielen halen na de serverwijziging vers op (live-datalaag).
    invalidateData("friendsChanged");
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

  async function changeDailyTextSource(source: string) {
    if (savingNotifications) return;
    setSavingNotifications(true);
    setDailyTextSourceError(null);
    try {
      const response = await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyTextSource: source }) });
      if (!response.ok) throw new Error("daily_text_source");
      setData(current => current ? { ...current, dailyTextSource: source } : current);
      afterAccountChange();
    } catch {
      setDailyTextSourceError(t("profile.dailyTextSourceSaveFailed"));
    } finally {
      setSavingNotifications(false);
    }
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
    setData({ ...data, handle: body.handle, displayName: body.handle, discriminator: body.discriminator });
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

  // Verwijderen vraagt een vers bewijs (wachtwoord, evt. 2FA-code); dat gebeurt op een eigen pagina, niet in een dialoog.
  function deleteAccount() {
    router.push("/account-verwijderen");
  }

  if (!data) {
    return (
      <ProfilePage>
        <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>
      </ProfilePage>
    );
  }

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
        {view === "guide" && <CompanionPreference onSave={async choice => { await jsonMutation("/api/account",{method:"PATCH",json:{companion:choice}},{invalidates:["today"]}); }} current={data.companion} onChanged={(companion) => setData((current) => (current ? { ...current, companion } : current))} />}
        {view === "language" && <LanguageSettings uiLanguage={data.uiLanguage} isAdmin={data.isAdmin} />}
        {view === "gameFeedback" && <GameFeedbackView />}
        {view === "readAloud" && <ReadAloudView voices={readAloudVoices} selectedVoice={selectedReadAloudVoice} speed={readAloudSpeed} testing={testingReadAloudVoice} onVoice={changeReadAloudVoice} onSpeed={changeReadAloudSpeed} onTest={testReadAloudVoice} />}
        {view === "notifications" && <NotificationsView data={data} saving={savingNotifications} pushError={pushError} testingPush={testingPush} pushCountdown={pushCountdown} pushTestMessage={pushTestMessage} onEmail={toggleEmailNotifications} onPush={togglePushNotifications} onTest={sendTestPush} onCategory={toggleCategory} onReminder={changeReminderTime} onDailyText={(time) => saveAccountPatch({ dailyTextTime: time }).then(() => setData((current) => current ? { ...current, dailyTextTime: time } : current))} onDailyTextSource={changeDailyTextSource} dailyTextSourceError={dailyTextSourceError} onPodcast={togglePodcastNotifications} />}
        {view === "privacy" && <PrivacyView data={data} saving={savingPrivacy} onToggleSearchable={toggleSearchableByEmail} onToggleAchievements={toggleShareAchievements} onTogglePuzzleRecords={toggleSharePuzzleRecords} onToggleVillage={toggleShareVillage} villageError={villagePrivacyError} />}
        {view === "presence" && <PresenceView data={data} saving={savingPresence} onOnline={toggleShareOnlineStatus} onActivity={toggleShareCurrentActivity} onIncognito={activateIncognito} onIncognitoOff={deactivateIncognito} />}
        {view === "about" && <WhatsNewView enabled={data.changelogEnabled} saving={savingNotifications} onToggle={() => toggleCategory("changelogEnabled")} />}
        {view === "twoFactor" && <TwoFactorSettings isAdmin={data.isAdmin} />}
      </ProfilePage>
    );
  }

  return <ProfileOverview data={data} editingHandle={editingHandle} handleInput={handleInput} savingHandle={savingHandle} handleError={handleError}
    startEditingHandle={startEditingHandle} setHandleInput={setHandleInput} setEditingHandle={setEditingHandle} saveHandle={saveHandle}
    openView={openView} savingNotifications={savingNotifications} toggleCategory={toggleCategory} logout={logout} deleteAccount={deleteAccount}
    villageEntry={<DorpEntry userId={data.id}/>} kompasEntry={<KompasEntryCard/>}
    timeZone={<TimeZoneRow known={data.timeZone} label={t("profile.timeZone")} format={zone => t("profile.timeZoneAuto", { zone })} locale={getLanguage(data.uiLanguage).intlLocale}/>}/>;
}
