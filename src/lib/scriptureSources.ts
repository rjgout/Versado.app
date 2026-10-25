import { seedBooks, type SeedBook } from "../../prisma/content";
import type { ChapterAudioSeed } from "../../prisma/importAudio";
import bomAudio from "../../prisma/bomAudio.json";
import bomAudioEn from "../../prisma/bomAudio.en.json";
import bomAudioDe from "../../prisma/bomAudio.de.json";
import bomAudioFr from "../../prisma/bomAudio.fr.json";
import bomAudioEs from "../../prisma/bomAudio.es.json";
import dcContent from "../../prisma/dcContent.json";
import pgpContent from "../../prisma/pgpContent.json";
import bomContentEn from "../../prisma/bomContent.en.json";
import bomContentEs from "../../prisma/bomContent.es.json";
import bomContentDe from "../../prisma/bomContent.de.json";
import bomContentFr from "../../prisma/bomContent.fr.json";
import dcContentEn from "../../prisma/dcContent.en.json";
import pgpContentEn from "../../prisma/pgpContent.en.json";
import {
  BOM_COLLECTION_ID, BOM_EN_COLLECTION_ID, BOM_ES_COLLECTION_ID, BOM_DE_COLLECTION_ID, BOM_FR_COLLECTION_ID,
  DC_COLLECTION_ID, DC_EN_COLLECTION_ID, PGP_COLLECTION_ID, PGP_EN_COLLECTION_ID,
} from "./contentCollections";

/** Eén Schriftbron die uit de repository komt: de collectie, haar boeken en (als die er zijn) de audiotijden. Eén lijst voor `runSeed` en de beheerflow. */
export interface ScriptureSource {
  id: string;
  label: string;
  books: SeedBook[];
  audio?: ChapterAudioSeed[];
}

export const SCRIPTURE_SOURCES: ScriptureSource[] = [
  { id: BOM_COLLECTION_ID, label: "Boek van Mormon (Nederlands)", books: seedBooks, audio: bomAudio as ChapterAudioSeed[] },
  { id: DC_COLLECTION_ID, label: "Leer en Verbonden", books: dcContent as SeedBook[] },
  { id: PGP_COLLECTION_ID, label: "Parel van Grote Waarde", books: pgpContent as SeedBook[] },
  { id: BOM_EN_COLLECTION_ID, label: "Book of Mormon (Engels)", books: bomContentEn as SeedBook[], audio: bomAudioEn as ChapterAudioSeed[] },
  { id: BOM_ES_COLLECTION_ID, label: "Libro de Mormón (Spaans)", books: bomContentEs as SeedBook[], audio: bomAudioEs as ChapterAudioSeed[] },
  { id: BOM_DE_COLLECTION_ID, label: "Das Buch Mormon (Duits)", books: bomContentDe as SeedBook[], audio: bomAudioDe as ChapterAudioSeed[] },
  { id: BOM_FR_COLLECTION_ID, label: "Le Livre de Mormon (Frans)", books: bomContentFr as SeedBook[], audio: bomAudioFr as ChapterAudioSeed[] },
  { id: DC_EN_COLLECTION_ID, label: "Doctrine and Covenants (Engels)", books: dcContentEn as SeedBook[] },
  { id: PGP_EN_COLLECTION_ID, label: "Pearl of Great Price (Engels)", books: pgpContentEn as SeedBook[] },
];
