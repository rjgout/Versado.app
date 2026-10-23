"use client";
import ProfilePage from "@/components/profile/ProfilePage";
import { useT } from "@/components/I18nProvider";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { AccountActionsProvider } from "@/components/account/AccountActionsProvider";
import PasswordChangeForm from "@/components/account/PasswordChangeForm";
import { webAccountActions } from "@/lib/account/web";

export default function ChangePasswordClient({ forced }: { forced: boolean }) {
  const navigation = useAppNavigation(), t = useT();
  return <AccountActionsProvider actions={webAccountActions}><ProfilePage title={t("profile.changePassword")}>
    <PasswordChangeForm forced={forced} onChanged={() => { navigation.push("/dashboard"); navigation.refresh(); }} />
  </ProfilePage></AccountActionsProvider>;
}
