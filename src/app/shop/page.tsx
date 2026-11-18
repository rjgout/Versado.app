import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { getCurrentUser } from "@/lib/session";
import ShopClient from "@/components/ShopClient";

export default async function ShopPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <WebGameBoundary><GameScreen component={ShopClient} view="shop" data={{}} /></WebGameBoundary>;
}
