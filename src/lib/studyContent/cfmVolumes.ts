/**
 * De jaargangen van "Kom dan en volg Mij" (CFM). Eén jaargang is één studiecollectie met een eigen werk, uitgave en
 * lesidentiteit; het programma "Kom dan en volg Mij" is de presentatielaag erboven (cfmProgramme.ts). Een nieuwe jaargang
 * toevoegen is dus alleen een regel hier (plus het bronmanifest en de brondata): geen datamodelmigratie, en bestaande
 * collectie-ID's, cursus-ID's en lesidentiteiten blijven ongewijzigd.
 *
 * Bewust zonder databaseclient en zonder Next-imports: ook bruikbaar in clientcode en in tests.
 */
export type CfmScripture = "old-testament" | "new-testament" | "book-of-mormon" | "doctrine-and-covenants";

export interface CfmVolume {
  /** Officiële programmajaargang (de kalenderweken van een jaargang mogen over de jaargrens lopen). */
  year: number;
  scripture: CfmScripture;
  /** ContentWork.key; de jaargang staat nooit in de primaire programmanaam. */
  workKey: string;
  editionKey: string;
  language: string;
  /** Vaste ContentCollection.id en slug: nooit afgeleid van volgorde of naam. */
  collectionId: string;
  collectionSlug: string;
}

/**
 * Chronologisch per taal. De eerste jaargang van een taal is het anker van het programma: zijn collectie draagt de
 * programmacursussen (Stap voor stap, Vrije studie), zodat cursus-ID's, inschrijvingen en voortgang nooit verhuizen.
 */
export const CFM_VOLUMES: readonly CfmVolume[] = [
  {
    year: 2026, scripture: "old-testament", workKey: "cfm-old-testament-2026", editionKey: "church-cfm-ot-2026", language: "nl",
    collectionId: "content_cfm_ot_2026_nl", collectionSlug: "cfm-ot-2026-nl",
  },
  // Nieuwe Testament 2027: staat hier vooraf vast zodat de identiteit stabiel is. Zolang de collectie niet bestaat (geen import)
  // of niet voor de gebruiker toegankelijk is, verschijnt er niets in de app, het archief of de kiezer.
  {
    year: 2027, scripture: "new-testament", workKey: "cfm-new-testament-2027", editionKey: "church-cfm-nt-2027", language: "nl",
    collectionId: "content_cfm_nt_2027_nl", collectionSlug: "cfm-nt-2027-nl",
  },
];
