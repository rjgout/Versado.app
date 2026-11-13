"use client";
import { useT } from "@/components/I18nProvider";
import { KompasIcon } from "@/components/kompas/KompasIcon";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import ProfileCharacterHero from "@/components/ProfileCharacterHero";
import ThemePreference from "@/components/ThemePreference";
import { companionName } from "@/components/versado/CompanionPicker";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import MascotSlot from "@/components/versado/MascotSlot";
import SystemIcon from "@/components/versado/SystemIcon";
import type { LeagueTier } from "@/generated/prisma/client";
import { formatTag } from "@/lib/handle";
import { getLanguage } from "@/lib/languages";
import type { ProfileView } from "@/lib/profileViews";
import { Bell,BookOpen,CalendarDays,ChevronRight,Globe2,KeyRound,LockKeyhole,LogOut,MessageSquare,Pencil,ShieldCheck,ShoppingBag,Smartphone,Sparkles,SunMoon,Trash2,Trophy,Users,Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ProfileData,ProfileToggleField } from "./profileData";
import ProfilePageView from "./ProfilePageView";
import { ProfileCard,SettingsButton,SettingsRow,SettingsSection,SettingsToggleRow } from "./settings";

export interface ProfileOverviewProps {
  data: ProfileData;
  editingHandle: boolean; handleInput: string; savingHandle: boolean; handleError: string | null;
  startEditingHandle(): void; setHandleInput(value: string): void; setEditingHandle(value: boolean): void; saveHandle(): Promise<void>;
  openView(view: ProfileView): void;
  savingNotifications: boolean; toggleCategory(field: ProfileToggleField): Promise<void>;
  logout(): Promise<void>; deleteAccount(): void;
  accountExtras?: ReactNode;
  timeZone: ReactNode; villageEntry?: ReactNode; kompasEntry?: ReactNode;
  canNavigate?(href: string): boolean;
}

/** Eén bestaande webweergave; alleen data, handelingen en bereikbare bestemmingen zijn platformafhankelijk. */
export default function ProfileOverview({ data, editingHandle, handleInput, savingHandle, handleError, startEditingHandle, setHandleInput, setEditingHandle, saveHandle, openView, savingNotifications, toggleCategory, logout, deleteAccount, timeZone, villageEntry, kompasEntry, accountExtras, canNavigate = () => true }: ProfileOverviewProps) {
  const t = useT();
  const tier = (value: LeagueTier) => t(`tiers.${value}`);
  const earnedCount = data.achievements.filter(a => a.earnedAt).length;
  return (
    <ProfilePageView overview title={t("nav.profile")}>
      {data.isAdmin && canNavigate("/adminbackend") && <Link href="/adminbackend" className="flex items-center gap-2 rounded-xl border border-vs-line bg-vs-surface px-4 py-3 text-sm font-bold text-vs-accent transition hover:bg-vs-subtle"><ShieldCheck className="h-5 w-5" aria-hidden />{t("profile.toAdmin")}</Link>}

      <section className="overflow-hidden rounded-3xl border border-vs-line bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm dark:from-brand-600 dark:to-brand-900">
        <ProfileCharacterHero
          appearance={{ avatarEmoji: data.avatarEmoji, avatarCharacterId: data.avatarCharacterId, avatarBackgroundId: data.avatarBackgroundId, avatarFrameId: data.avatarFrameId, avatarDecorationId: data.avatarDecorationId, avatarLightAccentId: data.avatarLightAccentId }}
          handle={data.handle}
          zoomInLabel={t("profile.zoomIn")}
          zoomOutLabel={t("profile.zoomOut")}
          changeLabel={t("profile.changeAvatar")}
          changeHref={canNavigate("/profile/avatar") ? "/profile/avatar" : undefined}
        />
        <div className="p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {!editingHandle ? <>
                <h2 className="flex min-w-0 items-center gap-1.5 text-xl font-extrabold"><span className="truncate">{data.displayName}</span><button type="button" onClick={startEditingHandle} className="shrink-0 opacity-80 hover:opacity-100" title={t("profile.changeHandle")} aria-label={t("profile.changeHandle")}><Pencil className="h-4 w-4" aria-hidden /></button></h2>
                <p className="truncate text-sm text-brand-100">{formatTag(data.handle, data.discriminator)}</p>
              </> : <div className="flex flex-col gap-2">
                <label className="flex min-w-0 items-center gap-2"><input className="input min-w-0 flex-1 !w-auto !py-1 !text-sm" value={handleInput} onChange={(event) => setHandleInput(event.target.value)} maxLength={24} autoFocus aria-label={t("profile.changeHandle")} /><span className="text-sm text-brand-100">#{data.discriminator}</span></label>
                {handleError && <p className="text-xs text-red-100">{handleError}</p>}
                <div className="flex gap-2"><button className="btn-primary !px-3 !py-1 !text-xs" disabled={savingHandle} onClick={saveHandle}>{savingHandle ? t("courses.busy") : t("profile.save")}</button><button className="btn-secondary !px-3 !py-1 !text-xs" onClick={() => setEditingHandle(false)}>{t("activeGames.cancel")}</button></div>
              </div>}
            </div>
            {data.tier && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/15 py-1 pl-1.5 pr-3 text-sm font-bold text-gold-400"><DivisionEmblem tier={data.tier} className="h-7 w-7" />{tier(data.tier)}</span>}
          </div>
        {/* Twee kolommen op een telefoon: "reeksbevriezingen" past niet naast drie andere cijfers in één rij. */}
        <div className="mt-5 grid grid-cols-2 gap-y-2 rounded-2xl bg-black/10 py-2 sm:grid-cols-4">
          <CompactHeroStat value={<><SystemIcon kind="streak" className="h-4 w-4" fill="currentColor" aria-hidden /> {data.currentStreak}</>} label={t("profile.streak")} href={canNavigate("/streak") ? "/streak" : undefined} />
          <CompactHeroStat value={<><SystemIcon kind="xp" className="h-4 w-4" fill="currentColor" aria-hidden /> {data.xpTotal}</>} label="XP" href={canNavigate("/xp") ? "/xp" : undefined} />
          <CompactHeroStat value={<><SystemIcon kind="freeze" className="h-4 w-4" aria-hidden /> {data.freezeCount}</>} label={t("lesson.freezes")} />
          <CompactHeroStat value={<><BookOpen className="h-4 w-4" aria-hidden /> {data.chaptersCompleted}</>} label={t("profile.chaptersShort")} />
        </div>
        </div>
      </section>

      {/* Acties direct onder de statistieken. Dit is de enige ingang naar
          de winkel; feedback staat er bewust naast. */}
      {(canNavigate("/shop") || canNavigate("/feedback")) && <div className="grid grid-cols-2 gap-3">
        {canNavigate("/shop") && <ProfileAction icon={<ShoppingBag className="h-5 w-5 text-vs-xp" aria-hidden />} label={t("nav.shop")} href="/shop" />}
        {canNavigate("/feedback") && <ProfileAction icon={<MessageSquare className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("pages.feedback")} href="/feedback" />}
      </div>}

      {villageEntry}
      {kompasEntry}

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
        <SettingsRow
          icon={<span className="block aspect-square w-10"><MascotSlot character={data.companion} state="greeting" size={40} fill /></span>}
          label={t("companion.profileTitle")}
          value={companionName(data.companion)}
          onClick={() => openView("guide")}
        />
        <SettingsRow icon={<Globe2 className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("languageSettings.title")} value={getLanguage(data.uiLanguage).nativeName} onClick={() => openView("language")} />
        <SettingsRow icon={<Volume2 className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.readAloud")} onClick={() => openView("readAloud")} />
        <SettingsRow icon={<Smartphone className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.gameFeedback.title")} onClick={() => openView("gameFeedback")} />
        <SettingsRow icon={<Bell className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.notifications")} onClick={() => openView("notifications")} />
        <SettingsRow icon={<Users className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.onlineActivity")} value={data.shareOnlineStatus ? t("twoFactor.on") : t("twoFactor.off")} onClick={() => openView("presence")} />
        <SettingsRow icon={<LockKeyhole className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.privacy")} onClick={() => openView("privacy")} />
        {timeZone}
        <SettingsToggleRow icon={<CalendarDays className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.conferenceCountdown")} description={t("profile.conferenceCountdownHint")} checked={data.conferenceCountdownEnabled} busy={savingNotifications} onChange={() => toggleCategory("conferenceCountdownEnabled")} />
        <SettingsToggleRow icon={<KompasIcon className="h-5 w-5 text-vs-accent" />} label={t("kompas.settings.offersTitle")} description={t("kompas.settings.offersHint")} checked={data.kompasOffersEnabled} busy={savingNotifications} onChange={() => toggleCategory("kompasOffersEnabled")} />
      </SettingsSection>

      <SettingsSection title={t("profile.aboutSection")}>
        <SettingsRow icon={<Sparkles className="h-5 w-5 text-vs-xp" aria-hidden />} label={t("profile.whatsNew")} onClick={() => openView("about")} />
        {canNavigate("/kompas") && <SettingsRow icon={<KompasIcon className="h-5 w-5 text-vs-accent" />} label={t("kompas.entry.title")} href="/kompas" />}
      </SettingsSection>

      <SettingsSection title={t("profile.accountSecuritySection")}>
        <SettingsRow icon={<ShieldCheck className="h-5 w-5 text-vs-accent" aria-hidden />} label={t("profile.twoFactor")} value={data.totpEnabled ? t("twoFactor.on") : t("twoFactor.off")} onClick={() => openView("twoFactor")} />
        {canNavigate("/change-password") && <SettingsRow icon={<KeyRound className="h-5 w-5 text-vs-fg-2" aria-hidden />} label={t("profile.changePassword")} href="/change-password" />}
        {accountExtras}
        <SettingsRow icon={<LogOut className="h-5 w-5 text-vs-fg-2" aria-hidden />} label={t("profile.logout")} onClick={logout} />
      </SettingsSection>

      {/* Bewust geen gewone rij: verwijderen hoort niet tussen de dagelijkse
          instellingen te concurreren. Bevestigen gaat via de dialoog. */}
      <SettingsButton variant="quietDanger" className="self-center" onClick={deleteAccount}>
        <Trash2 className="h-4 w-4" aria-hidden />
        {t("profile.deleteAccount")}
      </SettingsButton>
    </ProfilePageView>
  );
}

function ProfileAction({ icon, label, href }: { icon: ReactNode; label: string; href: string }) {
  return <Link href={href} className="bg-vs-surface flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-2xl border border-vs-line px-3 font-bold text-vs-fg transition hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"><span className="shrink-0">{icon}</span><span className="min-w-0 truncate">{label}</span></Link>;
}

function CompactHeroStat({ value, label, href }: { value: ReactNode; label: string; href?: string }) {
  const cell = "border-l border-white/15 max-sm:odd:border-l-0 sm:first:border-l-0";
  const content = <div className={`flex min-w-0 flex-col items-center gap-0.5 px-1 text-center ${href ? "" : cell}`}><div className="flex items-center gap-1 text-sm font-extrabold text-white">{value}</div><div className="whitespace-nowrap text-[0.625rem] font-bold uppercase leading-tight text-brand-100">{label}</div></div>;
  return href ? <Link href={href} className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${cell}`}>{content}</Link> : content;
}
