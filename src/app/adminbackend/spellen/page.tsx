import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminAlleskennerClient from "@/components/AdminAlleskennerClient";
import AdminGameSettingsClient from "@/components/AdminGameSettingsClient";
import AdminLeagueSettingsClient from "@/components/AdminLeagueSettingsClient";
import AdminLiveGamesClient from "@/components/AdminLiveGamesClient";
import { requireAdminPage } from "@/lib/adminGuard";
import { prisma } from "@/lib/db";
import { getLeagueSettings } from "@/lib/leagues";
import { getT } from "@/lib/i18n";

export default async function AdminGamesPage() {
  const user = await requireAdminPage();
  const t = getT(user.uiLanguage);
  const leagueSettings = await getLeagueSettings(prisma);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <AdminPageHeader title={t("adminHub.gamesTitle")} text={t("adminHub.gamesText")} />
      <AdminLiveGamesClient />
      <AdminGameSettingsClient />
      <AdminAlleskennerClient />
      <AdminLeagueSettingsClient initial={{ ...leagueSettings, activityRules: JSON.stringify(leagueSettings.activityRules, null, 2) }} />
    </div>
  );
}
