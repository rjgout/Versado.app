import { redirect } from "next/navigation";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getContentPickerContext } from "@/lib/contentCollections";
import FullscreenContentPicker from "@/components/content/FullscreenContentPicker";
import { hymnsPocAccess } from "@/lib/hymns/access";

export default async function ContentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [initialData, sessionKey] = await Promise.all([getContentPickerContext(user.id), navigationSessionKey()]);
  const showAdminHymns = user.isAdmin && hymnsPocAccess({
    production: process.env.NODE_ENV === "production",
    flag: process.env.HYMNS_POC,
    loggedIn: true,
    isAdmin: user.isAdmin,
  }) === "allow";
  return <FullscreenContentPicker initialData={initialData} sessionKey={sessionKey} isAdmin={user.isAdmin} showAdminHymns={showAdminHymns} />;
}
