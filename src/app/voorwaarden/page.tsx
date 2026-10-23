import { notFound } from "next/navigation";
import TermsContent from "@/components/legal/TermsContent";
import { TERMS } from "@/lib/legal/terms";

// Openbare pagina met de voorwaarden van de eigenaar; zonder aangeleverde tekst bestaat de pagina niet.
export default function TermsPage() {
  if (!TERMS) notFound();
  return <TermsContent document={TERMS} />;
}
