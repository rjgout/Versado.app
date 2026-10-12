import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { companionToMascot } from "@/lib/companion";
import { prisma } from "@/lib/db";
import QuickMissionaryRunClient from "@/components/snelleZendeling/RunClient";

export default async function QuickMissionaryRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const run = await prisma.quickMissionaryRun.findFirst({ where: { id: (await params).runId, userId: user.id }, select: { id: true } });
  if (!run) redirect("/live");
  return <QuickMissionaryRunClient runId={(await params).runId} character={companionToMascot(user.companion)} />;
}
