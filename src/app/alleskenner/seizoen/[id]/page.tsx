import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import SeasonClient from "@/components/alleskenner/SeasonClient";
import FocusLayout from "@/components/versado/FocusLayout";

export default async function AlleskennerSeasonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const settings = await getGameSettings();
  if (!settings.alleskennerEnabled && !user.isAdmin) redirect("/live");
  const { id } = await params;
  return <FocusLayout className="max-w-5xl"><SeasonClient id={id} /></FocusLayout>;
}
