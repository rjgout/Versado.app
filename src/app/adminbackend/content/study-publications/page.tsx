import { requireAdminPage } from "@/lib/adminGuard";
import { studyPublishingOverview } from "@/lib/studyContent/admin";
import AdminStudyPublicationsClient from "@/components/admin/AdminStudyPublicationsClient";
export default async function StudyPublicationsPage() {
  const user = await requireAdminPage();
  return (
    <AdminStudyPublicationsClient
      sessionKey={user.id}
      initialData={await studyPublishingOverview(user)}
    />
  );
}
