import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseQuickMissionary } from "@/lib/snelleZendeling/access";
import QuickMissionaryStartClient from "@/components/snelleZendeling/StartClient";

export default async function QuickMissionaryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseQuickMissionary(user.id, user.isAdmin))) redirect("/live");
  return <QuickMissionaryStartClient />;
}
