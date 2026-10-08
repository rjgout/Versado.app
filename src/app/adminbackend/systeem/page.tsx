import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminBrandingClient from "@/components/AdminBrandingClient";
import AdminDeployClient from "@/components/AdminDeployClient";
import ReseedClient from "@/components/ReseedClient";
import { requireAdminPage } from "@/lib/adminGuard";
import { prisma } from "@/lib/db";
import { isDeployAgentConfigured } from "@/lib/deployAgent";
import { getT } from "@/lib/i18n";

export default async function AdminSystemPage() {
  const user = await requireAdminPage();
  const t = getT(user.uiLanguage);
  const onlineUserCount = await prisma.user.count({ where: { isAdmin: false, onlineSocketCount: { gt: 0 } } });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <AdminPageHeader title={t("adminHub.systemTitle")} text={t("adminHub.systemText")} />
      <AdminDeployClient configured={isDeployAgentConfigured()} onlineUserCount={onlineUserCount} />
      <ReseedClient />
      <AdminBrandingClient />
    </div>
  );
}
