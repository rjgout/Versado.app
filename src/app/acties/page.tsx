import {gameRedirect as redirect} from "@/lib/games/navigation.server";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { getCurrentUser } from "@/lib/session";
import ActionsClient from "@/components/ActionsClient";

export default async function ActionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <WebGameBoundary><GameScreen view="actions" component={ActionsClient} data={{}}/></WebGameBoundary>;
}
