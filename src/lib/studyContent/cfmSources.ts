import type { StudyManifest } from "./manifest";
import { CFM_VOLUMES, type CfmVolume } from "./cfmVolumes";
import { cfmOldTestament2026NlManifest } from "./cfm2026Manifest";
import { OT_SCRIPTURE, type CfmScriptureProfile } from "./cfmScripture";
import sourceLock2026 from "../../../data/study-content/cfm-2026-nl/source-lock.json";
import mediaLock2026 from "../../../data/study-content/cfm-2026-nl/media-lock.json";
import { cfmNewTestament2027NlManifest } from "./cfm2027Manifest";
import sourceLock2027 from "../../../data/study-content/cfm-2027-nl/source-lock.json";
import mediaLock2027 from "../../../data/study-content/cfm-2027-nl/media-lock.json";
import referenceReview2026 from "../../../data/study-content/cfm-2026-nl/reference-review.json";

/** De handmatige verwijzingsbeoordeling van een jaargang (alleen CFM 2026 heeft er een; zie cfmReview.ts). */
export type CfmReferenceReview = typeof referenceReview2026;

/** Adapteridentiteit per jaargang: vast formaat, nooit afgeleid van een gebruikersinvoer. */
export type CfmAdapterName = `cfm-${number}-${string}-v1`;

/** Eén gepind bronbestand van de Church-content-API (bodytekst van één les). */
export interface CfmSource {
  uri: string;
  restricted: boolean;
  title: string;
  attributes: Record<string, string>;
  body: string;
}
export interface CfmMedia {
  url: string;
  checksum: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  file: string;
}
export interface CfmSourceLock {
  verifiedAt: string;
  source: string;
  lessons: Readonly<Record<string, string>>;
}

/**
 * Alles wat de generieke CFM-importvoorziening van één jaargang moet weten: de officiële bron (manifest, gepinde hashes,
 * gepinde media), de adapteridentiteit en het schriftuurprofiel. Een nieuwe jaargang toevoegen = een manifest, een
 * gegevensmap onder data/study-content/ en één regel hier (naast cfmVolumes.ts); er komt geen tweede importengine.
 */
export interface CfmVolumeSource {
  volume: CfmVolume;
  manifest: StudyManifest;
  /** Adapteridentiteit in de importaudit (ContentImportRun.adapterName), vast per jaargang. */
  adapter: CfmAdapterName;
  /** Map met de gepinde bron, relatief aan de projectroot. */
  dataDir: string;
  /** Het officiële handboek-pad van de jaargang: /manual/<slug>. */
  manualSlug: string;
  /** De taalcode in de URL van de officiële bron (nld). */
  churchLang: string;
  /** De collectienaam voor beheer; gebruikers zien altijd de programmanaam. */
  collectionName: string;
  sourceLock: CfmSourceLock;
  mediaLock: readonly CfmMedia[];
  /** Eerder handmatig beoordeelde onoplosbare verwijzingen; null voor een jaargang zonder zo'n lijst. */
  referenceReview: CfmReferenceReview | null;
  /** Zonder profiel krijgt de jaargang geen interne schriftlinks (zie cfmScripture.ts). */
  scripture: CfmScriptureProfile | null;
  /** Bestanden (in dataDir) die samen de goedgekeurde bronsnapshot vormen, in vaste volgorde. */
  approvalFiles: readonly string[];
}

const volumeOfWork = (workKey: string) => {
  const volume = CFM_VOLUMES.find((v) => v.workKey === workKey);
  if (!volume) throw new Error(`CFM_VOLUME_UNREGISTERED:${workKey}`);
  return volume;
};

export const CFM_SOURCE_2026: CfmVolumeSource = {
  volume: volumeOfWork(cfmOldTestament2026NlManifest.workKey),
  manifest: cfmOldTestament2026NlManifest,
  adapter: "cfm-2026-nl-v1" satisfies CfmAdapterName,
  dataDir: "data/study-content/cfm-2026-nl",
  manualSlug: "come-follow-me-for-home-and-church-old-testament-2026",
  churchLang: "nld",
  collectionName: "Kom dan en volg Mij 2026 — Oude Testament",
  sourceLock: sourceLock2026,
  mediaLock: mediaLock2026,
  referenceReview: referenceReview2026,
  scripture: OT_SCRIPTURE,
  approvalFiles: ["source-lock.json", "media-lock.json", "otb-index.json", "reference-source-checks.json", "reference-review.json"],
};

/**
 * Nieuwe Testament 2027. De importadapter houdt de officiële bron-URL omdat deze gepinde index alleen het Oude Testament
 * dekt. De centrale resolver controleert daarna de werkelijk beschikbare interne editie; ook oude diagnoses worden bij
 * bewezen overeenstemming opnieuw beoordeeld, zonder herimport.
 */
export const CFM_SOURCE_2027: CfmVolumeSource = {
  volume: volumeOfWork(cfmNewTestament2027NlManifest.workKey),
  manifest: cfmNewTestament2027NlManifest,
  adapter: "cfm-2027-nl-v1" satisfies CfmAdapterName,
  dataDir: "data/study-content/cfm-2027-nl",
  manualSlug: "come-follow-me-for-home-and-church-new-testament-2027",
  churchLang: "nld",
  collectionName: "Kom dan en volg Mij 2027 — Nieuwe Testament",
  sourceLock: sourceLock2027,
  mediaLock: mediaLock2027,
  referenceReview: null,
  scripture: null,
  approvalFiles: ["source-lock.json", "media-lock.json"],
};

/** Alle jaargangen met een gepinde officiële bron, chronologisch. Een jaargang zonder bron staat hier (nog) niet. */
export const CFM_SOURCES: readonly CfmVolumeSource[] = [CFM_SOURCE_2026, CFM_SOURCE_2027];

export const cfmSourceOfWork = (workKey: string | null | undefined) => CFM_SOURCES.find((s) => s.manifest.workKey === workKey);
export const cfmSourceOfAdapter = (adapter: string | null | undefined) => (adapter ? CFM_SOURCES.find((s) => s.adapter === adapter) : undefined);
/** Is dit een geregistreerde officiële CFM-adapter? Geen naamherkenning: alleen een bekende, gepinde bron telt. */
export const isCfmAdapter = (adapter: string | null | undefined) => cfmSourceOfAdapter(adapter) !== undefined;
/** Exacte identiteit: werk, uitgavefamilie en taal moeten allemaal kloppen. */
export const cfmSourceOfCollection = (c: { work: string | null; editionKey: string; language: string }) =>
  CFM_SOURCES.find((s) => s.manifest.workKey === c.work && s.manifest.editionKey === c.editionKey && s.manifest.language === c.language);
