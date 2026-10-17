import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

// Oude links en bladwijzers naar /bookmarks blijven werken: de gebruikerspagina is Mijn studiemap.
// De opgeslagen bladwijzers en /api/bookmarks blijven ongewijzigd.
export default async function BookmarksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect("/study-folder?type=bookmark");
}
