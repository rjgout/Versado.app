"use client";

import { useEffect, useId, useState } from "react";
import { Bell, BellRing, CalendarClock, Mail, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import AppSelect from "@/components/AppSelect";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import { formatTag } from "@/lib/handle";
import { isPushSupported } from "@/lib/pushClient";
import {
  ProfileCard,
  SettingsActions,
  SettingsButton,
  SettingsField,
  SettingsSection,
  SettingsStatus,
  SettingsToggleRow,
  settingsFieldClass,
  settingsInlineFieldClass,
} from "@/components/profile/settings";
import type { ProfileData, ProfileToggleField } from "@/components/profile/profileData";

// De instellingenonderdelen van het profiel (/profile?view=...). Alleen
// weergave: de gegevens en het opslaan blijven in ProfileClient, zodat er
// één bron is voor wat er op de server staat. Zie docs/PROFIEL.md.

export function ReadingView({ resetting, message, error, onReset }: { resetting: boolean; message: string | null; error: string | null; onReset: () => void }) {
  const t = useT();
  return (
    <ProfileCard
      title={t("profile.readingReset")}
      description={t("profile.readingResetText")}
      actions={
        message ? (
          <SettingsStatus kind="success">{message}</SettingsStatus>
        ) : (
          <>
            <SettingsButton variant="danger" disabled={resetting} onClick={onReset}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {resetting ? t("courses.busy") : t("profile.readingReset")}
            </SettingsButton>
            {error && <SettingsStatus kind="error">{error}</SettingsStatus>}
          </>
        )
      }
    />
  );
}

export function ReadAloudView({
  voices,
  selectedVoice,
  speed,
  testing,
  onVoice,
  onSpeed,
  onTest,
}: {
  voices: SpeechSynthesisVoice[];
  selectedVoice: string;
  speed: number;
  testing: boolean;
  onVoice: (value: string) => void;
  onSpeed: (value: number) => void;
  onTest: () => void;
}) {
  const t = useT();
  return (
    <SettingsSection description={t("profile.readAloudText")}>
      {voices.length > 0 ? (
        <>
          <SettingsField label={t("profile.dutchVoice")}>
            <AppSelect
              className={settingsFieldClass}
              value={selectedVoice}
              onChange={onVoice}
              ariaLabel={t("profile.dutchVoice")}
              options={[{ value: "", label: t("profile.automatic") }, ...voices.map((voice) => ({ value: voice.voiceURI, label: voice.name }))]}
            />
          </SettingsField>
          <SettingsField label={t("profile.readAloudSpeed")} inline>
            <AppSelect
              className={settingsInlineFieldClass}
              value={String(speed)}
              onChange={(value) => onSpeed(Number(value))}
              ariaLabel={t("profile.readAloudSpeed")}
              options={[0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}×` }))}
            />
          </SettingsField>
          <SettingsActions>
            <SettingsButton disabled={testing} onClick={onTest}>
              <Volume2 className="h-4 w-4" aria-hidden />
              {testing ? t("profile.samplePlaying") : t("profile.listenVoiceLabel")}
            </SettingsButton>
            <span className="text-xs text-vs-fg-3">{t("profile.savedOnDevice")}</span>
          </SettingsActions>
        </>
      ) : (
        <div className="px-2 py-3">
          <SettingsStatus>{t("profile.noVoices")}</SettingsStatus>
        </div>
      )}
    </SettingsSection>
  );
}

export function NotificationsView({
  data,
  saving,
  pushError,
  testingPush,
  pushCountdown,
  pushTestMessage,
  onEmail,
  onPush,
  onTest,
  onCategory,
  onReminder,
  onDailyText,
}: {
  data: ProfileData;
  saving: boolean;
  pushError: string | null;
  testingPush: boolean;
  pushCountdown: number | null;
  pushTestMessage: string | null;
  onEmail: () => void;
  onPush: () => void;
  onTest: () => void;
  onCategory: (field: ProfileToggleField) => void;
  onReminder: (value: string) => void;
  onDailyText: (value: string) => void;
}) {
  const t = useT();
  const dailyTextTimeId = useId();
  const reminderTimeId = useId();
  // Pas na het laden bekend: op de server bestaat er geen Notification-API.
  const [pushSupported, setPushSupported] = useState(true);
  useEffect(() => setPushSupported(isPushSupported()), []);

  const kind = (field: ProfileToggleField, label: string, description?: string) => (
    <SettingsToggleRow label={label} description={description} checked={data[field]} busy={saving} onChange={() => onCategory(field)} />
  );

  return (
    <>
      <SettingsSection title={t("profile.channelsSection")} description={t("profile.notificationsText")}>
        <SettingsToggleRow
          icon={<Mail className="h-5 w-5 text-vs-accent" aria-hidden />}
          label={t("profile.emailLabel")}
          description={t("profile.emailTo", { email: data.email })}
          checked={data.emailNotificationsEnabled}
          busy={saving}
          onChange={onEmail}
        />
        <SettingsToggleRow
          icon={<BellRing className="h-5 w-5 text-vs-accent" aria-hidden />}
          label={t("profile.pushLabel")}
          description={pushSupported ? t("profile.pushHint") : t("profile.pushUnsupported")}
          checked={data.pushNotificationsEnabled}
          disabled={!pushSupported}
          busy={saving}
          onChange={onPush}
        />
        {pushError && (
          <div className="px-2 py-3">
            <SettingsStatus kind="error">{pushError}</SettingsStatus>
          </div>
        )}
        {data.pushNotificationsEnabled && (
          <SettingsActions>
            <SettingsButton disabled={testingPush} onClick={onTest}>
              <Bell className="h-4 w-4" aria-hidden />
              {pushCountdown !== null ? t("profile.pushIn", { n: pushCountdown }) : testingPush ? t("courses.busy") : t("profile.sendTestPush")}
            </SettingsButton>
            {pushTestMessage && <SettingsStatus>{pushTestMessage}</SettingsStatus>}
          </SettingsActions>
        )}
      </SettingsSection>

      <SettingsSection title={t("profile.dailySection")}>
        <SettingsToggleRow
          icon={<CalendarClock className="h-5 w-5 text-vs-accent" aria-hidden />}
          label={t("profile.dailyText")}
          description={t("profile.dailyTextHint")}
          checked={data.notifyDailyText}
          busy={saving}
          onChange={() => onCategory("notifyDailyText")}
        />
        <SettingsField label={t("profile.timeLabel")} htmlFor={dailyTextTimeId} inline>
          <input id={dailyTextTimeId} type="time" className={settingsInlineFieldClass} value={data.dailyTextTime} onChange={(event) => onDailyText(event.target.value)} />
        </SettingsField>
        <SettingsToggleRow
          icon={<Bell className="h-5 w-5 text-vs-accent" aria-hidden />}
          label={t("profile.reminderLabel")}
          description={t("profile.reminderHint")}
          checked={data.notifyDailyReminder}
          busy={saving}
          onChange={() => onCategory("notifyDailyReminder")}
        />
        <SettingsField label={t("profile.timeLabel")} htmlFor={reminderTimeId} inline>
          <input id={reminderTimeId} type="time" className={settingsInlineFieldClass} value={data.dailyReminderTime} onChange={(event) => onReminder(event.target.value)} />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title={t("profile.kindsSection")}>
        {kind("notifySocial", t("profile.socialLabel"), t("profile.socialHint"))}
        {kind("notifyActivityReactions", t("profile.activityReactionsLabel"), t("profile.activityReactionsHint"))}
        {kind("notifyStreakReturn", t("streakReturn.setting"), t("streakReturn.settingHint"))}
        {kind("notifyAchievements", t("profile.achievementsLabel"), t("profile.achievementsHint"))}
        {kind("notifyWordGame", t("profile.wordGameLabel"), t("profile.wordGameHint"))}
        {kind("notifyFriendOnline", t("profile.friendOnlineLabel"), t("profile.friendOnlineHint"))}
        {kind("nudgesEnabled", t("together.profile.nudges"))}
      </SettingsSection>
    </>
  );
}

export function PrivacyView({ data, saving, onToggleSearchable, onToggleAchievements }: { data: ProfileData; saving: boolean; onToggleSearchable: () => void; onToggleAchievements: () => void }) {
  const t = useT();
  return (
    <SettingsSection>
      <SettingsToggleRow
        label={t("profile.searchableLabel")}
        description={`${t("profile.searchableDesc", { email: data.email })} ${t("profile.searchableHint", { tag: formatTag(data.handle, data.discriminator) })}`}
        checked={data.searchableByEmail}
        busy={saving}
        onChange={onToggleSearchable}
      />
      <SettingsToggleRow
        label={t("profile.shareAchievementsLabel")}
        description={t("profile.shareAchievementsDesc")}
        checked={data.shareAchievements}
        busy={saving}
        onChange={onToggleAchievements}
      />
    </SettingsSection>
  );
}

export function PresenceView({
  data,
  saving,
  onOnline,
  onActivity,
  onIncognito,
  onIncognitoOff,
}: {
  data: ProfileData;
  saving: boolean;
  onOnline: () => void;
  onActivity: () => void;
  onIncognito: (hours: 1 | 4 | 12 | 24) => void;
  onIncognitoOff: () => void;
}) {
  const t = useT();
  return (
    <>
      <SettingsSection>
        <SettingsToggleRow
          label={t("profile.shareOnlineLabel")}
          description={t("profile.shareOnlineDesc")}
          checked={data.shareOnlineStatus}
          busy={saving}
          onChange={onOnline}
        />
        {/* Activiteit delen zonder online-status heeft geen zin; zichtbaar
            maar uit, met de reden erbij (zie toggleShareOnlineStatus). */}
        <SettingsToggleRow
          label={t("profile.shareActivityLabel")}
          description={data.shareOnlineStatus ? t("profile.shareActivityDesc") : t("profile.shareActivityNeedsOnline")}
          checked={data.shareOnlineStatus && data.shareCurrentActivity}
          disabled={!data.shareOnlineStatus}
          busy={saving}
          onChange={onActivity}
        />
      </SettingsSection>

      <ProfileCard
        title={t("profile.incognitoTitle")}
        description={t("profile.incognitoHint")}
        actions={
          data.incognitoActive ? (
            <>
              <SettingsStatus kind="success">{t("profile.incognitoActive")}</SettingsStatus>
              <SettingsButton onClick={onIncognitoOff} disabled={saving}>
                {t("profile.incognitoOff")}
              </SettingsButton>
            </>
          ) : (
            ([1, 4, 12, 24] as const).map((hours) => (
              <SettingsButton key={hours} onClick={() => onIncognito(hours)} disabled={saving}>
                {t("profile.hoursN", { n: hours })}
              </SettingsButton>
            ))
          )
        }
      />
    </>
  );
}

interface ChangelogEntryView {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/**
 * Wat is er nieuw: de schakelaar voor de melding bij inloggen en de hele
 * lijst. Openen telt als gezien, net als "Gelezen" in de pop-up
 * (ChangelogPopup.tsx).
 */
export function WhatsNewView({ enabled, saving, onToggle }: { enabled: boolean; saving: boolean; onToggle: () => void }) {
  const t = useT();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [entries, setEntries] = useState<ChangelogEntryView[] | null>(null);

  useEffect(() => {
    fetch("/api/changelog")
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((body) => setEntries(body.entries ?? []))
      .catch(() => setEntries([]));
    fetch("/api/changelog/seen", { method: "POST" }).catch(() => {});
  }, []);

  return (
    <>
      <SettingsSection>
        <SettingsToggleRow
          icon={<Sparkles className="h-5 w-5 text-vs-xp" aria-hidden />}
          label={t("profile.changelogLabel")}
          description={t("profile.changelogToggle")}
          checked={enabled}
          busy={saving}
          onChange={onToggle}
        />
      </SettingsSection>

      <SettingsSection title={t("profile.changesSection")}>
        {!entries ? (
          <p className="px-2 py-3 text-sm text-vs-fg-3">{t("common.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-3 text-sm text-vs-fg-3">{t("profile.noChangelog")}</p>
        ) : (
          entries.map((entry) => (
            <article key={entry.id} className="px-2 py-3">
              <p className="text-xs font-bold text-vs-fg-3">
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString(intlLocale, { day: "numeric", month: "long", year: "numeric" })}</time>
              </p>
              <h3 className="mt-0.5 font-bold text-vs-fg">{entry.title}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-vs-fg-2">{entry.body}</p>
            </article>
          ))
        )}
      </SettingsSection>
    </>
  );
}
