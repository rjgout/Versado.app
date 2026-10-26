import inventory from "../../../data/audio/official-inventory.json";
import alignments from "../../../data/audio/official-alignments.json";
import { objectHash } from "./contract";

export interface OfficialSource {
  id: string; collectionId: string; work: string; editionKey: string; language: string;
  bookKey: string; chapterNumber: number; sourceHash: string; voice: string; url: string;
  sha256: string; bytes: number; duration: number; verses: number; pageUrl: string;
  quality: string; starts: number[]; legacyProtected: boolean; pilot: boolean;
}
type Alignment = { quality: string; sha256: string; sourceHash: string; sourceUrl: string; starts: number[]; duration: number };
const known = alignments.recordings as unknown as Record<string, Alignment>;
export const officialSources: OfficialSource[] = inventory.chapters.flatMap((chapter) => chapter.recordings.map((recording) => {
  const aligned = known[`${recording.sha256}-${chapter.sourceHash}`];
  const identity = { work: chapter.work, editionKey: chapter.editionKey, language: chapter.language, bookKey: chapter.bookKey, chapterNumber: chapter.chapterNumber, voice: recording.voice, url: recording.url, sha256: recording.sha256, sourceHash: chapter.sourceHash };
  // FR Alma 30 heeft twee officiële URL's met exact dezelfde bytes en tekst. Grenzen binden aan die hashes;
  // de actuele bron-URL/stem wordt afzonderlijk tegen de officiële hoofdstukpagina gecontroleerd.
  const safe = aligned?.quality === "VALIDATED" && aligned.sha256 === recording.sha256 && aligned.sourceHash === chapter.sourceHash && Math.abs(aligned.duration - recording.duration) <= 0.15 && aligned.starts.length === chapter.expectedVerseCount && aligned.starts.every((start, i, all) => Number.isFinite(start) && start >= 0 && start < recording.duration && (!i || all[i - 1] < start));
  return { ...identity, id: objectHash(identity), collectionId: chapter.collectionId!, bytes: recording.bytes, duration: recording.duration, verses: chapter.expectedVerseCount, pageUrl: chapter.pageUrl, quality: safe ? "VALIDATED" : "NEEDS_REVIEW", starts: aligned?.starts ?? [], legacyProtected: chapter.language === "nl" && chapter.legacySeedListed, pilot: chapter.work === "bofm" && chapter.bookKey === "bofm/ether" && chapter.chapterNumber === 1 && recording.voice === (chapter.language === "en" ? "male" : "audio") };
}));
export const pilotSources = officialSources.filter((source) => source.pilot);
export const officialSource = (id: string) => officialSources.find((source) => source.id === id);
