import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import WordDetailClient from "@/components/WordDetailClient";

// Eén woord van het woordenboek; de deeplink /tools/dictionary/<woord> werkt ook zonder eerst de lijst te openen.
export default async function DictionaryWordPage({ params }: { params: Promise<{ word: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { word } = await params;
  let decoded = word;
  try {
    decoded = decodeURIComponent(word);
  } catch {
    /* een ongeldige %-reeks: het ruwe segment tonen als "niet gevonden" */
  }
  return <WordDetailClient word={decoded} />;
}
