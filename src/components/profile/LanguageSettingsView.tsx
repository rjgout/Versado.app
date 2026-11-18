"use client";
import AppSelect from "@/components/AppSelect";
import { useT } from "@/components/I18nProvider";
import { LANGUAGES,getLanguage } from "@/lib/languages";
import { SettingsField,SettingsSection,SettingsStatus,settingsFieldClass } from "./settings";
export default function LanguageSettingsView({ uiLanguage, isAdmin, contentLanguage, contentLanguages, saving, error, onUiLanguage, onContentLanguage }: {
  uiLanguage:string; isAdmin:boolean; contentLanguage:string|null; contentLanguages:string[]; saving:boolean; error:string|null;
  onUiLanguage(value:string):void; onContentLanguage(value:string):void;
}) {
  const t=useT();
  const uiChoices = LANGUAGES.filter((language) => language.uiReady || isAdmin || language.code === uiLanguage);
  const contentChoices = LANGUAGES.filter((language) => contentLanguages.includes(language.code));

  return (
    <SettingsSection>
      <SettingsField label={t("languageSettings.appLanguage")} description={t("languageSettings.appLanguageHint")}>
        {uiChoices.length > 1 ? (
          <AppSelect
            className={settingsFieldClass}
            value={uiLanguage}
            disabled={saving}
            onChange={(value) => onUiLanguage(value)}
            ariaLabel={t("languageSettings.appLanguage")}
            options={uiChoices.map((language) => ({ value: language.code, label: `${language.nativeName}${language.uiReady ? "" : ` ${t("languageSettings.inDevelopment")}`}` }))}
          />
        ) : (
          <p className="text-sm text-vs-fg-2">{t("languageSettings.moreFollow", { language: getLanguage(uiLanguage).nativeName })}</p>
        )}
      </SettingsField>

      <SettingsField label={t("languageSettings.textLanguage")} description={t("languageSettings.textLanguageHint")}>
        {contentLanguage === null ? (
          <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>
        ) : contentChoices.length > 1 ? (
          <AppSelect
            className={settingsFieldClass}
            value={contentLanguage}
            disabled={saving}
            onChange={(value) => onContentLanguage(value)}
            ariaLabel={t("languageSettings.textLanguage")}
            options={contentChoices.map((language) => ({ value: language.code, label: language.nativeName }))}
          />
        ) : (
          <p className="text-sm text-vs-fg-2">{t("languageSettings.moreFollow", { language: getLanguage(contentLanguage).nativeName })}</p>
        )}
      </SettingsField>

      {error && (
        <div className="px-2 py-3">
          <SettingsStatus kind="error">{error}</SettingsStatus>
        </div>
      )}
    </SettingsSection>
  );
}
