"use client";
import ProfilePage from "@/components/profile/ProfilePage";
import { useT } from "@/components/I18nProvider";
import { AppLink, useAppNavigation } from "@/components/navigation/AppNavigation";
import { AccountActionsProvider } from "@/components/account/AccountActionsProvider";
import AccountDeletionForm from "@/components/account/AccountDeletionForm";
import { webAccountActions } from "@/lib/account/web";
import { rich } from "@/lib/i18n/rich";

// Openbaar bereikbaar (ook zonder login, voor wie de app niet meer heeft); het formulier verschijnt alleen voor een ingelogde gebruiker.
// Geen bewaartermijnen of juridische beloftes hier: die staan in de privacyverklaring.
export default function AccountDeletionClient({ signedIn, passwordLoginEnabled, totpEnabled }: { signedIn: boolean; passwordLoginEnabled: boolean; totpEnabled: boolean }) {
  const navigation = useAppNavigation(), t = useT();
  const link = "underline text-brand-600 dark:text-brand-300";
  return <ProfilePage title={t("accountDeletion.title")}>
    <div className="flex flex-col gap-3 px-1">
      <h2 className="text-lg font-extrabold">{t("accountDeletion.whatTitle")}</h2>
      <p>{rich(t("accountDeletion.whatBody"), { link: <AppLink href="/privacy" className={link}>{t("accountDeletion.privacyLink")}</AppLink> })}</p>
      <h2 className="mt-2 text-lg font-extrabold">{t("accountDeletion.howTitle")}</h2>
      <ul className="list-disc pl-5"><li>{t("accountDeletion.howApp")}</li><li>{t("accountDeletion.howWeb")}</li></ul>
      <h2 className="mt-2 text-lg font-extrabold">{t("accountDeletion.noAccessTitle")}</h2>
      <p>{t("accountDeletion.noAccessBody")}</p>
    </div>
    {signedIn ? <AccountActionsProvider actions={webAccountActions}>
      <AccountDeletionForm passwordLoginEnabled={passwordLoginEnabled} totpEnabled={totpEnabled} onDeleted={() => { navigation.push("/"); navigation.refresh(); }} />
    </AccountActionsProvider> : <div className="flex flex-col gap-3 px-1">
      <p className="font-bold">{t("accountDeletion.signedOutHint")}</p>
      <div className="flex flex-wrap gap-3">
        <AppLink href="/login" className="btn btn-primary">{t("accountDeletion.loginCta")}</AppLink>
        <AppLink href="/forgot-password" className="btn btn-secondary">{t("accountDeletion.forgotCta")}</AppLink>
      </div>
    </div>}
  </ProfilePage>;
}
