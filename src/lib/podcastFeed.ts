import Parser from "rss-parser";
import type { PrismaClient } from "@/generated/prisma/client";
import { ensurePodcasts, PODCASTS, type PodcastDefinition } from "./podcasts";
import { parseChaptersFile } from "./podcastChapters";

interface FeedItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  enclosure?: { url: string; length?: number; type?: string };
  "itunes:episode"?: string;
  "itunes:summary"?: string;
  transcripts?: { $?: { url?: string; type?: string } }[];
  chaptersTag?: { $?: { url?: string; type?: string } };
}

const FETCH_TIMEOUT_MS = 10_000;

// We halen de XML zelf op met de ingebouwde fetch() (met een harde
// AbortSignal-timeout) en geven de tekst aan parseString() door, in plaats
// van rss-parser's eigen parseURL() te gebruiken — die leunt op een oudere
// http(s)-clientlaag waarvan de eigen timeout-optie niet betrouwbaar bleek
// bij een hangende/geblokkeerde verbinding. Zonder een harde timeout kan een
// onbereikbare feed-server db:seed (en dus ook de adminbackend-knop) voor
// onbepaalde tijd laten hangen — dit is een aanvulling die nooit de rest van
// de content-import mag blokkeren.
const parser = new Parser<Record<string, unknown>, FeedItem>({
  customFields: {
    item: [
      "itunes:episode",
      "itunes:summary",
      ["podcast:transcript", "transcripts", { keepArray: true }],
      ["podcast:chapters", "chaptersTag"],
    ],
  },
});

async function fetchFeedXml(url: string): Promise<string> {
  // Sommige feed-hosts weigeren requests zonder (herkenbare) User-Agent.
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "Geloof-je-dat-ook-app/1.0 (+podcastfeed-sync)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Probeert het aflevering­nummer te herleiden: eerst uit het itunes:episode-
// veld (als de feed dat meegeeft), anders uit een nummer vooraan de titel
// ("127: ...", "127 - ...", "Aflevering 127: ...", "#127 ..."). Vindt geen
// van beide een nummer, dan slaan we die aflevering over — beter dan een
// gok die per ongeluk een bestaande aflevering overschrijft.
function extractEpisodeNumber(item: FeedItem): number | null {
  const fromItunes = item["itunes:episode"]?.trim();
  if (fromItunes && /^\d+$/.test(fromItunes)) {
    return parseInt(fromItunes, 10);
  }

  const title = item.title ?? "";
  const patterns = [/^\s*(?:aflevering\s*)?#?(\d{1,5})\s*[:.\-–]/i, /^\s*#(\d{1,5})\b/];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

// De app zet zelf "Aflevering N — " voor de titel; een feed die het nummer
// ook in de titel zet ("Aflevering 82: de rechtszaak ...") gaf dan het nummer
// dubbel. Blijft er niets over, dan de titel zoals hij was.
function cleanTitle(raw: string): string {
  const stripped = raw.replace(/^\s*(?:aflevering\s*)?#?\d{1,5}\s*[:.\-–]\s*/i, "").trim();
  if (!stripped) return raw;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function extractSummary(item: FeedItem): string | null {
  const raw = item.contentSnippet ?? item["itunes:summary"] ?? item.summary ?? item.content ?? "";
  const cleaned = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Standaardtekst die sommige podcasthosts aan elke omschrijving plakken:
    // een link om de makers te mailen, en bij oudere afleveringen een
    // doorverwijzing naar de website. Hoort niet in de cursus.
    .replace(/^Send us Fan Mail\s*/i, "")
    .replace(/\s*The post .* first appeared on .*$/i, "")
    .trim();
  return cleaned || null;
}

// Een feed kan per aflevering meerdere transcripten geven (vtt, srt, json,
// html); vtt heeft de voorkeur, want daar is de werkwijze op ingericht.
function extractTranscriptUrl(item: FeedItem): string | null {
  const transcripts = (item.transcripts ?? []).map((t) => t.$).filter((t) => t?.url);
  const vtt = transcripts.find((t) => t?.type === "text/vtt");
  return (vtt ?? transcripts[0])?.url ?? null;
}

function extractChaptersUrl(item: FeedItem): string | null {
  const url = item.chaptersTag?.$?.url?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

async function fetchChapters(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "Geloof-je-dat-ook-app/1.0 (+podcastfeed-sync)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.stringify(parseChaptersFile(await res.json()));
}

/**
 * Haalt de hoofdstukkenbestanden op die nieuw of veranderd zijn. Een bestand
 * dat niet te laden is, laat de vorige hoofdstukken staan en wordt bij de
 * volgende sync opnieuw geprobeerd (chaptersUrl blijft dan de oude waarde).
 */
async function syncChapters(
  client: PrismaClient,
  podcast: PodcastDefinition,
  wanted: { id: string; url: string | null; storedUrl: string | null; hasChapters: boolean }[],
  log: (msg: string) => void
): Promise<void> {
  const removed = wanted.filter((w) => !w.url && (w.storedUrl || w.hasChapters));
  for (const w of removed) {
    await client.podcastEpisode.update({ where: { id: w.id }, data: { chaptersUrl: null, chapters: null } });
  }
  const todo = wanted.filter((w) => w.url && (w.url !== w.storedUrl || !w.hasChapters));
  let fetched = 0;
  const failed: string[] = [];
  const queue = [...todo];
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const chapters = await fetchChapters(next.url!);
        await client.podcastEpisode.update({ where: { id: next.id }, data: { chaptersUrl: next.url, chapters } });
        fetched++;
      } catch (e) {
        failed.push(e instanceof Error ? e.message : String(e));
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (todo.length || removed.length) {
    log(
      `  Hoofdstukken van ${podcast.name}: ${fetched} opgehaald` +
        (removed.length ? `, ${removed.length} weggehaald` : "") +
        (failed.length ? `, ${failed.length} mislukt (volgende sync opnieuw)` : "") +
        "."
    );
  }
}

/**
 * Haalt de feed van elke podcast op (zie src/lib/podcasts.ts) en zet elke
 * aflevering die erin staat neer als PodcastEpisode-rij (titel/omschrijving/
 * link/publicatiedatum/transcript), zodat die nooit met de hand overgetypt
 * hoeven te worden. Raakt bewust nooit PodcastExercise-rijen aan: de
 * oefeningen per aflevering blijven handwerk (zie prisma/podcastContent.ts +
 * prisma/importPodcast.ts) en worden hier niet aangemaakt of overschreven —
 * een nieuwe aflevering verschijnt dus met de juiste naam/omschrijving in de
 * cursus, met "oefeningen volgen nog" totdat die met de hand zijn toegevoegd.
 *
 * Faalt het ophalen van een feed (offline, onbereikbaar, onverwacht formaat),
 * dan loggen we een waarschuwing i.p.v. de hele content-import te laten
 * mislukken: dit is een aanvulling op db:seed, geen vereiste stap. Een
 * mislukte feed slaat ook de andere podcasts niet over.
 */
export interface PodcastFeedSyncOptions {
  /** Alleen de scheduler geeft dit mee: handmatige contentimport mag geen meldingen uitsturen. */
  onEpisodeCreated?: (podcast: PodcastDefinition, episode: { id: string; number: number; title: string }) => Promise<void>;
}

export async function syncPodcastFeed(
  client: PrismaClient,
  log: (msg: string) => void = console.log,
  options: PodcastFeedSyncOptions = {}
): Promise<void> {
  await ensurePodcasts(client);
  for (const podcast of PODCASTS) {
    await syncOnePodcast(client, podcast, log, options);
  }
}

async function syncOnePodcast(
  client: PrismaClient,
  podcast: PodcastDefinition,
  log: (msg: string) => void,
  options: PodcastFeedSyncOptions
): Promise<void> {
  let feed;
  try {
    const xml = await fetchFeedXml(podcast.feedUrl);
    feed = await parser.parseString(xml);
  } catch (e) {
    log(`Feed van ${podcast.name} ophalen mislukt: ${e instanceof Error ? e.message : String(e)} — overgeslagen.`);
    return;
  }

  let created = 0;
  let updated = 0;
  const chapterWork: { id: string; url: string | null; storedUrl: string | null; hasChapters: boolean }[] = [];
  for (const item of feed.items) {
    const number = extractEpisodeNumber(item);
    if (number === null) {
      log(`  Kon geen aflevering­nummer herleiden uit "${item.title ?? "(zonder titel)"}" — overgeslagen.`);
      continue;
    }

    const title = cleanTitle(item.title?.trim() ?? "") || `Aflevering ${number}`;
    const summary = extractSummary(item);
    // Bewust twee losse velden: listenUrl is de webpagina (RSS <link>, voor
    // "bekijk op de website"), audioUrl het daadwerkelijk afspeelbare bestand
    // (RSS <enclosure>, voor de ingebouwde speler) — een webpagina-URL werkt
    // niet als <audio src>.
    const listenUrl = item.link ?? null;
    const audioUrl = item.enclosure?.url ?? null;
    const transcriptUrl = extractTranscriptUrl(item);
    const isoDate = item.isoDate ?? item.pubDate;
    const publishedAt = isoDate && !Number.isNaN(Date.parse(isoDate)) ? new Date(isoDate) : null;

    const where = { podcastId_number: { podcastId: podcast.id, number } };
    const data = { title, summary, listenUrl, audioUrl, transcriptUrl, publishedAt, order: -number };
    const existing = await client.podcastEpisode.findUnique({ where, select: { id: true, chaptersUrl: true, chapters: true } });
    const saved = await client.podcastEpisode.upsert({
      where,
      update: data,
      create: { podcastId: podcast.id, number, ...data },
      select: { id: true },
    });
    chapterWork.push({ id: saved.id, url: extractChaptersUrl(item), storedUrl: existing?.chaptersUrl ?? null, hasChapters: !!existing?.chapters });
    if (existing) updated++;
    else {
      created++;
      // Een mislukte afleveringmelding mag de feed nooit vertragen of de
      // overige metadata-updates verhinderen. De volgende RSS-sync blijft
      // daardoor altijd bruikbaar, ook als e-mail tijdelijk niet werkt.
      await options.onEpisodeCreated?.(podcast, { id: saved.id, number, title }).catch((error) => {
        log(`  Melding voor nieuwe aflevering van ${podcast.name} mislukt: ${error instanceof Error ? error.message : String(error)}.`);
      });
    }
  }

  log(`Feed van ${podcast.name} gesynchroniseerd: ${created} nieuw, ${updated} bijgewerkt.`);
  await syncChapters(client, podcast, chapterWork, log);
}
