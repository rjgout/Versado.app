import { canStartGame } from "@/lib/gameAvailability";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import FamilyGameSetupClient from "@/components/FamilyGameSetupClient";

export default async function GezinsavondPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "gezinsavond"))) redirect("/live?availability=unavailable");
  return <FamilyGameSetupClient />;
}
