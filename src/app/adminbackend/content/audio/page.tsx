import { requireAdminPage } from "@/lib/adminGuard";
import { audioOverview } from "@/lib/audio/library";
import AdminAudioClient from "@/components/admin/AdminAudioClient";
import { officialOverview } from "@/lib/audio/officialJobs";
export default async function AudioPage() {
  const user = await requireAdminPage();
  return <AdminAudioClient initialData={await audioOverview()} initialOfficial={await officialOverview()} sessionKey={`${user.id}:${user.sessionVersion}`} />;
}
