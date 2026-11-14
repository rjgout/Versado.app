/** Basisversie voor bestaande jaargangen. 2027 gebruikt een eigen versie; oude vingerafdrukken blijven herleidbaar. */
export const PERSONAL_STUDY_VERSION = 2;
/** Maandag t/m zaterdag; de zondag blijft vrij als rustdag en is dus geen studiestap. Een aanbeveling, geen dagschema. */
export const PERSONAL_STUDY_STEPS = 6;
/** De eerste indeling (versie 1, zeven stappen). Alleen nog gebruikt om bestaande voortgang inhoudelijk te dekken. */
export const LEGACY_PERSONAL_STUDY = { version: 1, steps: 7 } as const;
