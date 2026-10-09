import { normalizeCharacterId, type CanonicalCharacterId } from "@/lib/characterAssets";

// Deze constante staat bewust in de lichte mappingmodule: de personenzoeker is
// een clientcomponent en mag via deze mapping geen Prisma/servercode bundelen.
const BOM_COLLECTION_ID = "content_bom";

// Expliciet per collectie: namen/slugs zijn geen stabiele visuele identiteit.
// Bewust geen Alma-mapping: de seed beschrijft `alma` niet betrouwbaar genoeg
// om Alma de oudere of de jongere zonder inhoudelijke gok te onderscheiden.
const PERSON_CHARACTER_IDS: Record<string, string> = {
  [`${BOM_COLLECTION_ID}:aaron`]: "aaron",
  [`${BOM_COLLECTION_ID}:abinadi`]: "abinadi",
  [`${BOM_COLLECTION_ID}:alma-de-jongere`]: "alma-younger",
  [`${BOM_COLLECTION_ID}:amlici`]: "amlici",
  [`${BOM_COLLECTION_ID}:ammaron`]: "ammaron",
  [`${BOM_COLLECTION_ID}:ammon`]: "ammon-missionary",
  [`${BOM_COLLECTION_ID}:ammon-2`]: "ammon-expedition",
  [`${BOM_COLLECTION_ID}:amulek`]: "amulek",
  [`${BOM_COLLECTION_ID}:abish`]: "abish",
  [`${BOM_COLLECTION_ID}:benjamin`]: "king-benjamin",
  [`${BOM_COLLECTION_ID}:brother-of-jared`]: "brother-of-jared",
  [`${BOM_COLLECTION_ID}:corianton`]: "corianton",
  [`${BOM_COLLECTION_ID}:ether`]: "ether",
  [`${BOM_COLLECTION_ID}:gideon`]: "gideon",
  [`${BOM_COLLECTION_ID}:hagoth`]: "hagoth",
  [`${BOM_COLLECTION_ID}:ishmael`]: "ismael",
  [`${BOM_COLLECTION_ID}:jakob`]: "jacob-son-lehi",
  [`${BOM_COLLECTION_ID}:jozef`]: "joseph-son-lehi",
  [`${BOM_COLLECTION_ID}:laban`]: "laban",
  [`${BOM_COLLECTION_ID}:laman`]: "laman",
  [`${BOM_COLLECTION_ID}:lamoni`]: "lamoni",
  [`${BOM_COLLECTION_ID}:lehi`]: "lehi",
  [`${BOM_COLLECTION_ID}:limhi`]: "king-limhi",
  [`${BOM_COLLECTION_ID}:lemuel`]: "lemuel",
  [`${BOM_COLLECTION_ID}:mormon`]: "mormon",
  [`${BOM_COLLECTION_ID}:moroni`]: "moroni-son-mormon",
  [`${BOM_COLLECTION_ID}:moroni-bevelhebber`]: "captain-moroni",
  [`${BOM_COLLECTION_ID}:mosiah`]: "mosiah-son-benjamin",
  [`${BOM_COLLECTION_ID}:nephi`]: "nephi",
  [`${BOM_COLLECTION_ID}:nehor`]: "nehor",
  [`${BOM_COLLECTION_ID}:pahoran`]: "pahoran",
  [`${BOM_COLLECTION_ID}:sam`]: "sam",
  [`${BOM_COLLECTION_ID}:samuel-de-lamaniet`]: "samuel-lamanite",
  [`${BOM_COLLECTION_ID}:sariah`]: "sariah",
  [`${BOM_COLLECTION_ID}:sherem`]: "sherem",
  [`${BOM_COLLECTION_ID}:shiblon`]: "shiblon",
  [`${BOM_COLLECTION_ID}:zeezrom`]: "zeezrom",
  [`${BOM_COLLECTION_ID}:zeniff`]: "zeniff",
  [`${BOM_COLLECTION_ID}:zoram`]: "zoram",
  [`${BOM_COLLECTION_ID}:vrouw-van-ishmael`]: "ismael-wife",
  [`${BOM_COLLECTION_ID}:vrouw-van-nephi`]: "nephi-wife",
  [`${BOM_COLLECTION_ID}:koningin-1`]: "lamoni-wife",
  [`${BOM_COLLECTION_ID}:koningin-2`]: "lamoni-father-wife",
};

export function characterIdForPerson(collectionId: string, personSlug: string): CanonicalCharacterId | null {
  return normalizeCharacterId(PERSON_CHARACTER_IDS[`${collectionId}:${personSlug}`]);
}
