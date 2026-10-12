import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canStartGame } from "@/lib/gameAvailability";
import SeasonListClient from "@/components/alleskenner/SeasonListClient";

export default async function AlleskennerSeasonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "alleskenner"))) redirect("/live?availability=unavailable");
  return <SeasonListClient />;
}
