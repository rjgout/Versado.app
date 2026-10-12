import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { canStartGame, canResumeGameContent } from "@/lib/gameAvailability";
import SoloClient from "@/components/alleskenner/SoloClient";

export default async function AlleskennerSoloPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const allowStarts = await canStartGame(user.id, "alleskenner");
  const hasRun = await prisma.alleskennerSoloRun.count({ where: { userId: user.id, status: "IN_PROGRESS" } });
  if (!allowStarts && (!hasRun || !(await canResumeGameContent("content_bom")))) redirect("/live?availability=unavailable");
  return <SoloClient myUserId={user.id} allowStarts={allowStarts} />;
}
