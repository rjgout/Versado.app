import { BookMarked, BookOpen, Gem, LibraryBig, Mic2, ScrollText, type LucideIcon } from "lucide-react";
import type { LanguageCode } from "@/lib/languages";

type ContentCollectionIdentity = { id: string; work: string | null };

// Per contentbron (werk) op één plek: het icoon en de afkorting per taal.
// De volledige naam staat per uitgave in de database (ContentCollection.name,
// al in de taal van die uitgave). Header en contentkiezer gebruiken allebei
// alleen dit bestand.
//
// Een ontbrekende afkorting is bewust: past de volledige naam niet, dan
// toont de header alleen het icoon. Verzin er dus geen bij; nu zonder
// afkorting: fsy (Voor de kracht van de jeugd) en podcasts.
interface ContentMetadata {
  icon: LucideIcon;
  /** Officieel bronbeeld; de naam en afkorting blijven echte UI-tekst. */
  asset?: string;
  abbreviations?: Partial<Record<LanguageCode, string>>;
}

export const CONTENT_SOURCE_ICON_PATHS = {
  bofm: "/icons/content-sources/bofm.webp",
  "dc-testament": "/icons/content-sources/dc-testament.webp",
  pgp: "/icons/content-sources/pgp.webp",
  "old-testament": "/icons/content-sources/old-testament.webp",
  "new-testament": "/icons/content-sources/new-testament.webp",
  fsy: "/icons/content-sources/fsy.webp",
  podcasts: "/icons/content-sources/podcasts.webp",
  generic: "/icons/content-sources/source-generic.webp",
} as const;

const CONTENT_METADATA: Record<string, ContentMetadata> = {
  bofm: { asset: CONTENT_SOURCE_ICON_PATHS.bofm, icon: BookOpen, abbreviations: { nl: "BvM", en: "BoM", de: "BM", fr: "LdM", es: "LdM" } },
  "dc-testament": { asset: CONTENT_SOURCE_ICON_PATHS["dc-testament"], icon: ScrollText, abbreviations: { nl: "LV", en: "D&C", de: "LuB", fr: "D&A", es: "DyC" } },
  pgp: { asset: CONTENT_SOURCE_ICON_PATHS.pgp, icon: Gem, abbreviations: { nl: "PGW", en: "PoGP", de: "KP", fr: "PGP", es: "PGP" } },
  "old-testament": { asset: CONTENT_SOURCE_ICON_PATHS["old-testament"], icon: ScrollText, abbreviations: { nl: "OT", en: "OT", de: "AT", fr: "AT", es: "AT" } },
  "new-testament": { asset: CONTENT_SOURCE_ICON_PATHS["new-testament"], icon: BookOpen, abbreviations: { nl: "NT", en: "NT", de: "NT", fr: "NT", es: "NT" } },
  fsy: { asset: CONTENT_SOURCE_ICON_PATHS.fsy, icon: BookMarked },
  podcasts: { asset: CONTENT_SOURCE_ICON_PATHS.podcasts, icon: Mic2 },
};

function metadataFor(collection: ContentCollectionIdentity): ContentMetadata | undefined {
  return CONTENT_METADATA[collection.work ?? collection.id];
}

export function contentIcon(collection: ContentCollectionIdentity): LucideIcon {
  return metadataFor(collection)?.icon ?? LibraryBig;
}

/** Geeft eerst het specifieke bronbeeld en daarna de neutrale toekomstfallback. */
export function contentIconSources(collection: ContentCollectionIdentity): readonly string[] {
  const specific = metadataFor(collection)?.asset;
  return specific ? [specific, CONTENT_SOURCE_ICON_PATHS.generic] : [CONTENT_SOURCE_ICON_PATHS.generic];
}

/** De afkorting in de taal van de uitgave, of null als er (nog) geen is. */
export function contentAbbreviation(collection: ContentCollectionIdentity, language: string): string | null {
  return metadataFor(collection)?.abbreviations?.[language as LanguageCode] ?? null;
}
