import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AlleskennerRoom from "@/components/alleskenner/AlleskennerRoom";
import FocusLayout from "@/components/versado/FocusLayout";

export default async function AlleskennerSoloGamePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  return <FocusLayout className="max-w-5xl"><AlleskennerRoom code={`SOLO-${id}`} soloRunId={id} /></FocusLayout>;
}
