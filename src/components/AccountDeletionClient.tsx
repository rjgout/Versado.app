"use client";
import ProfilePage from "@/components/profile/ProfilePage";
import { useT } from "@/components/I18nProvider";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { AccountActionsProvider } from "@/components/account/AccountActionsProvider";
import AccountDeletionForm from "@/components/account/AccountDeletionForm";
import { webAccountActions } from "@/lib/account/web";

export default function AccountDeletionClient({ passwordLoginEnabled, totpEnabled }: { passwordLoginEnabled: boolean; totpEnabled: boolean }) {
  const navigation = useAppNavigation(), t = useT();
  return <AccountActionsProvider actions={webAccountActions}><ProfilePage title={t("accountDeletion.title")}>
    <AccountDeletionForm passwordLoginEnabled={passwordLoginEnabled} totpEnabled={totpEnabled} onDeleted={() => { navigation.push("/"); navigation.refresh(); }} />
  </ProfilePage></AccountActionsProvider>;
}
