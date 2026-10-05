import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { companionToMascot } from "@/lib/companion";
import { canUseQuickMissionary } from "@/lib/snelleZendeling/access";
import QuickMissionaryRunClient from "@/components/snelleZendeling/RunClient";

export default async function QuickMissionaryRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseQuickMissionary(user.id, user.isAdmin))) redirect("/live");
  return <QuickMissionaryRunClient runId={(await params).runId} character={companionToMascot(user.companion)} />;
}
