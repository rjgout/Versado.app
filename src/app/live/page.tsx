import ProgramContextPanel from "@/components/study/ProgramContextPanel";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";
import LiveLobbyForm from "@/components/LiveLobbyForm";

export default async function LivePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, contentContext] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  return (
    <div className="min-w-0 space-y-6">
    <ProgramContextPanel actor={user}/>
    <LiveLobbyForm
      settings={settings}
      isAdmin={user.isAdmin}
      allowedGameKeys={contentContext.gameKeys}
      contentName={contentContext.active.name}
    />
    </div>
  );
}
