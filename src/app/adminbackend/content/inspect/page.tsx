import { requireAdminPage } from "@/lib/adminGuard";
import { navigationSessionKey } from "@/lib/session";
import { getAdminContentInspection } from "@/lib/adminContentInspection";
import AdminContentInspectionClient from "@/components/admin/AdminContentInspectionClient";

export default async function AdminContentInspectionPage() {
  await requireAdminPage();
  const [initialData, sessionKey] = await Promise.all([getAdminContentInspection(), navigationSessionKey()]);
  return <AdminContentInspectionClient initialData={initialData} sessionKey={sessionKey} />;
}
