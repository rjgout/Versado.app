import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import StudyFolderClient from "@/components/study-folder/StudyFolderClient";

// Accountbreed en privé: geen contentkeuze, geen cache; de gegevens komen uit /api/study-folder.
export const dynamic = "force-dynamic";

export default async function StudyFolderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <Suspense fallback={null}>
      <StudyFolderClient />
    </Suspense>
  );
}
