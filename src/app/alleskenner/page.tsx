import { canStartGame } from "@/lib/gameAvailability";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AlleskennerSetupClient from "@/components/alleskenner/AlleskennerSetupClient";

export default async function AlleskennerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "alleskenner"))) redirect("/live?availability=unavailable");

  return <AlleskennerSetupClient />;
}
