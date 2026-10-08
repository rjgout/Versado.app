import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminChangelogClient from "@/components/AdminChangelogClient";
import EmailSettingsClient from "@/components/EmailSettingsClient";
import FeedbackAdminClient from "@/components/FeedbackAdminClient";
import { requireAdminPage } from "@/lib/adminGuard";
import { getEmailSettingsView } from "@/lib/email";
import { getT } from "@/lib/i18n";

export default async function AdminCommunicationPage() {
  const user = await requireAdminPage();
  const t = getT(user.uiLanguage);
  const emailSettings = await getEmailSettingsView();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <AdminPageHeader title={t("adminHub.commsTitle")} text={t("adminHub.commsText")} />
      <FeedbackAdminClient />
      <EmailSettingsClient initial={emailSettings} />
      <AdminChangelogClient />
    </div>
  );
}
