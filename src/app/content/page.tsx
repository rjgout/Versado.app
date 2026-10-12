import { redirect } from "next/navigation";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getContentPickerContext } from "@/lib/contentCollections";
import FullscreenContentPicker from "@/components/content/FullscreenContentPicker";

export default async function ContentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [initialData, sessionKey] = await Promise.all([getContentPickerContext(user.id), navigationSessionKey()]);
  return <FullscreenContentPicker initialData={initialData} sessionKey={sessionKey} isAdmin={user.isAdmin} />;
}
