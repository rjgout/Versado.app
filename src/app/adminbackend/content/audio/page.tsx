import { requireAdminPage } from "@/lib/adminGuard";
import { audioOverview } from "@/lib/audio/library";
import AdminAudioClient from "@/components/admin/AdminAudioClient";
export default async function AudioPage() {
  const user = await requireAdminPage();
  return <AdminAudioClient initialData={await audioOverview()} sessionKey={`${user.id}:${user.sessionVersion}`} />;
}
