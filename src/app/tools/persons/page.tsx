import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { BOM_COLLECTION_ID, DC_COLLECTION_ID, getContentContext } from "@/lib/contentCollections";
import PersonsSearch from "./persons-search";
import PageIntro from "@/components/versado/PageIntro";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/core";

// Collecties met eigen personages, elk met een eigen inleidende zin (de naam
// van het werk staat midden in de zin, met lidwoord). Bij andere content
// vallen we terug op het Boek van Mormon, zodat een oude link nooit een lege
// pagina geeft.
const PERSON_COLLECTIONS: Record<string, MessageKey> = {
  [BOM_COLLECTION_ID]: "persons.introBofm",
  [DC_COLLECTION_ID]: "persons.introDc",
};

export default async function PersonsToolPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = getT(user.uiLanguage);

  const { active } = await getContentContext(user.id);
  const collectionId = active.id in PERSON_COLLECTIONS ? active.id : BOM_COLLECTION_ID;

  const persons = await prisma.person.findMany({
    where: { contentCollectionId: collectionId },
    orderBy: { name: "asc" },
    include: {
      father: { select: { slug: true, name: true } },
      mother: { select: { slug: true, name: true } },
      children: { select: { slug: true, name: true }, orderBy: { name: "asc" } },
    },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageIntro title={t("persons.title")} text={t(PERSON_COLLECTIONS[collectionId], { n: persons.length })} />
      <PersonsSearch persons={persons} />
    </div>
  );
}
