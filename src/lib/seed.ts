import { PrismaClient } from "@/generated/prisma/client";
import { seedBooks } from "../../prisma/content";
import { withContentImportLock } from "./contentImportLock";
import { SCRIPTURE_SOURCES } from "./scriptureSources";
import { syncCourses } from "./courses";
import { importBooks } from "../../prisma/importContent";
import { importChapterAudio, type ChapterAudioSeed } from "../../prisma/importAudio";
import { mirrorChapterAudio } from "./audioMirror";
import bomAudio from "../../prisma/bomAudio.json";
import {
  BOM_COLLECTION_ID,
  DC_COLLECTION_ID,
} from "./contentCollections";
import { podcastEpisodes } from "../../prisma/podcastContent";
import { kastVanMormonEpisodes } from "../../prisma/kastVanMormonContent";
import { GJDO_PODCAST_ID, KAST_PODCAST_ID } from "./podcasts";
import { importPodcastEpisodes } from "../../prisma/importPodcast";
import { syncPodcastFeed } from "./podcastFeed";
import { syncFsyContent } from "./fsyContent";
import { importKidsStories, type KidsStorySeed } from "../../prisma/importKids";
import kidsManifest from "../../prisma/kidsManifest.json";
import { importIntroLessons, importIntroPersons } from "../../prisma/importIntro";
import { introLessons } from "../../prisma/introContent";
import { introPersons } from "../../prisma/introPersons";
import { dcPersons } from "../../prisma/dcPersons";
import { alleskennerItems } from "../../prisma/alleskennerContent";
import { generatedAlleskennerItems } from "../../prisma/alleskennerGenerated";
import { importAlleskennerItems, importAlleskennerTranslations } from "../../prisma/importAlleskenner";
import { alleskennerTranslations } from "../../prisma/alleskennerTranslate";
import { inPhase } from "./importPhase";
import { preparePinnedOtbSource } from "../../scripts/otb/source";
import { importOtbTrial, type OtbImportProgress } from "../../scripts/otb/import-core";
import { importGeneesBank } from "../../prisma/importGenees";
import { GENEES_BANKS } from "../../prisma/genees";

// Namen/omschrijvingen bij de achievement-slugs uit src/lib/achievements.ts.
const achievementDefs = [
  { slug: "streak-3", name: "Drie dagen volgehouden", icon: "🔥", description: "Hield 3 dagen op rij een streak vol." },
  { slug: "streak-7", name: "Eerste week", icon: "🔥", description: "Hield 7 dagen op rij een streak vol." },
  { slug: "streak-30", name: "Vol doorgezet", icon: "🔥", description: "Hield 30 dagen op rij een streak vol." },
  { slug: "streak-100", name: "Honderd dagen sterk", icon: "💯", description: "Hield 100 dagen op rij een streak vol." },
  { slug: "first-chapter", name: "Eerste hoofdstuk", icon: "📖", description: "Rondde je eerste hoofdstuk af." },
  { slug: "chapters-5", name: "Op dreef", icon: "📚", description: "Rondde 5 hoofdstukken af." },
  { slug: "chapters-10", name: "Tien hoofdstukken", icon: "📚", description: "Rondde 10 hoofdstukken af." },
  { slug: "chapters-25", name: "Vijfentwintig hoofdstukken", icon: "🏅", description: "Rondde 25 hoofdstukken af." },
  { slug: "chapters-50", name: "Halve honderd", icon: "🏆", description: "Rondde 50 hoofdstukken af." },
  { slug: "perfect-chapter", name: "Volmaakt", icon: "💯", description: "Rondde een hoofdstuk af met 100%." },
  { slug: "perfect-10", name: "Tien keer raak", icon: "🎯", description: "Rondde 10 hoofdstukken af met 100%." },
  { slug: "xp-1000", name: "1000 XP", icon: "⭐", description: "Verdiende in totaal 1000 XP." },
  { slug: "xp-5000", name: "5000 XP", icon: "🌟", description: "Verdiende in totaal 5000 XP." },
  { slug: "xp-10000", name: "10.000 XP", icon: "🏆", description: "Verdiende in totaal 10.000 XP." },
  { slug: "first-freeze-earned", name: "Eerste freeze", icon: "🧊", description: "Verdiende je eerste streak freeze." },
  { slug: "first-freeze-gifted", name: "Vrijgevig", icon: "🎁", description: "Gaf je eerste streak freeze cadeau aan een vriend." },
  { slug: "first-friend", name: "Niet alleen", icon: "👥", description: "Voegde je eerste vriend toe." },
  { slug: "friends-5", name: "Vriendenkring", icon: "👨‍👩‍👧‍👦", description: "Heeft 5 vrienden." },
  { slug: "first-duel-won", name: "Eerste overwinning", icon: "⚔️", description: "Won je eerste live Schriftduel." },
  { slug: "duels-10-won", name: "Duelmeester", icon: "🏅", description: "Won 10 live Schriftduels." },
  { slug: "family-game-first-play", name: "Gezinsavond", icon: "🎉", description: "Speelde het Gezinsavondspel voor het eerst uit." },
  { slug: "word-game-first-win", name: "Woordkunstenaar", icon: "🔤", description: "Raadde het woord van de dag voor het eerst goed." },
  { slug: "word-game-7-wins", name: "Woordmeester", icon: "🧠", description: "Raadde 7 keer het woord van de dag goed." },
  { slug: "podcast-first-lesson", name: "Eerste podcastles", icon: "🎧", description: "Rondde je eerste podcastles af." },
  { slug: "podcast-10-lessons", name: "Podcastluisteraar", icon: "🎙️", description: "Rondde 10 podcastlessen af." },
  { slug: "kids-first-story", name: "Eerste kinderles", icon: "🌟", description: "Rondde je eerste verhaal uit de kindercursus af." },
  { slug: "kids-10-stories", name: "Verhalenverteller", icon: "📚", description: "Rondde 10 verhalen uit de kindercursus af." },
  { slug: "intro-first-lesson", name: "Op ontdekking", icon: "🧭", description: "Rondde je eerste introductieles af." },
  { slug: "intro-all-lessons", name: "Helemaal op weg", icon: "🎓", description: "Rondde alle introductielessen af." },
  { slug: "friend-streak-1", name: "Samen begonnen", icon: "🤝", description: "Haalde de eerste dag van een vriendenreeks." },
  { slug: "friend-streak-7", name: "Een week samen", icon: "🔥", description: "Hield een vriendenreeks 7 dagen vol." },
  { slug: "friend-streak-30", name: "Een maand samen", icon: "📅", description: "Hield een vriendenreeks 30 dagen vol." },
  { slug: "friend-streak-100", name: "Honderd dagen", icon: "💯", description: "Hield een vriendenreeks 100 dagen vol." },
  { slug: "friend-streak-365", name: "Een jaar samen", icon: "🏆", description: "Hield een vriendenreeks 365 dagen vol." },
];

/**
 * De volledige seed-routine — herbruikbaar vanaf de CLI (`npm run db:seed`,
 * zie prisma/seed.ts) én vanuit de adminbackend (zie `/api/admin/reseed`),
 * die deze in-process aanroept met de gedeelde Prisma-client van de app in
 * plaats van er zelf een nieuwe voor op te zetten. `log` is injecteerbaar
 * zodat de adminbackend de voortgangsregels kan opvangen en teruggeven aan
 * de admin, in plaats van dat ze alleen in de containerlogs verdwijnen.
 */

export interface SeedOptions {
  /** Standaard true (CLI en volledige seed). Bij false blijven de Schriftteksten (ook de Bijbel/OTB), hun oefeningen en de audio (inclusief het spiegelen van audiobestanden) onaangeroerd: die lopen via de beheerflow "Schriftbronnen bijwerken". */
  scriptures?: boolean;
}

export async function runSeed(
  client: PrismaClient,
  log: (msg: string) => void = console.log,
  progress?: (progress: OtbImportProgress) => void,
  studyImport?: () => Promise<void>,
  options: SeedOptions = {},
): Promise<void> {
  // Nooit twee imports tegelijk (adminknop en terminal, of een dubbele klik): de tweede stopt netjes met een duidelijke melding.
  await withContentImportLock(() => runSeedLocked(client, log, progress, studyImport, options));
}

async function runSeedLocked(
  client: PrismaClient,
  log: (msg: string) => void,
  progress?: (progress: OtbImportProgress) => void,
  studyImport?: () => Promise<void>,
  options: SeedOptions = {},
): Promise<void> {
  const scriptures = options.scriptures !== false;
  if (studyImport) await inPhase("Studiecontent", studyImport);
  if (scriptures) {
    log("Seeding boeken, hoofdstukken, verzen en oefeningen...");
    await inPhase("Boeken", () => importBooks(client, seedBooks, log, BOM_COLLECTION_ID));
    await inPhase("Voorgelezen hoofdstukken", () => importChapterAudio(client, bomAudio as ChapterAudioSeed[], BOM_COLLECTION_ID, log));
  }

  // De OTB-import staat los van de cursussen: hij gebruikt geen syncCourses en
  // draait pas na de eerste cursussynchronisatie, maar een fout daarin blijft
  // een Bijbelfout en een cursusfout hierboven blijft een cursusfout.
  if (scriptures) {
    log("Open Translation Bible voorbereiden...");
    await inPhase("Bijbel (OTB)", async () => {
      const otbSource = await preparePinnedOtbSource(log);
      await importOtbTrial(client, otbSource, log, progress);
    });
  }

  // Leer en Verbonden en de Parel van Grote Waarde, en de Engelse uitgaven
  // van alle drie, elk in een eigen collectie. Alleen als die collectie
  // bestaat (migraties 20260924200000_dc_pgp_collections en
  // 20260925120000_english_editions), anders zou importBooks ze bij het
  // Boek van Mormon zetten. De taal van de collectie bepaalt de taal van de
  // gegenereerde oefeningen en hints.
  let loopFailed = false;
  try {
    for (const { id: collectionId, books, label, audio } of scriptures ? SCRIPTURE_SOURCES.filter((source) => source.id !== BOM_COLLECTION_ID) : []) {
      if (!(await client.contentCollection.findUnique({ where: { id: collectionId }, select: { id: true } }))) continue;
      log(`Seeding ${label}...`);
      await inPhase(`Boeken (${label})`, async () => {
        await importBooks(client, books, log, collectionId, { syncCourses: false });
        if (audio) await importChapterAudio(client, audio, collectionId, log);
      });
    }
  } catch (error) {
    loopFailed = true;
    throw error;
  } finally {
    // De cursussen één keer na alle overige collecties (voorheen na elke collectie opnieuw), ook als er halverwege iets misging: wat wel
    // is binnengekomen krijgt zo zijn lessen. Een fout hier verdringt nooit de oorspronkelijke fout; slaagde de lus wel, dan is een mislukte
    // synchronisatie een echte fout van de run (anders blijven oefenkoppelingen onbemerkt achter).
    log("Cursussen synchroniseren...");
    let syncError: unknown = null;
    await inPhase("Cursussen", () => syncCourses(client)).catch((error) => {
      syncError = error;
      log(`Cursussen synchroniseren mislukt: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (syncError && !loopFailed) throw syncError;
  }

  log("Seeding podcastafleveringen...");
  await inPhase("Podcasts", async () => {
    await importPodcastEpisodes(client, GJDO_PODCAST_ID, podcastEpisodes, log);
    await importPodcastEpisodes(client, KAST_PODCAST_ID, kastVanMormonEpisodes, log);
    log("Podcastfeed ophalen voor titels/omschrijvingen en nieuwe afleveringen...");
    await syncPodcastFeed(client, log);
  });

  log("FSY-content controleren op nieuwe lessen...");
  await inPhase("FSY", () => syncFsyContent(client, log));

  log("Seeding kindercursus (Verhalen uit het Boek van Mormon)...");
  await inPhase("Kindercursus", () => importKidsStories(client, kidsManifest as KidsStorySeed[], log));

  log("Seeding personen voor de introductiecursus...");
  await inPhase("Introductiecursus", async () => {
    await importIntroPersons(client, introPersons, log);
    log("Seeding personen uit de Leer en Verbonden...");
    await importIntroPersons(client, dcPersons, log, DC_COLLECTION_ID);
    log("Seeding introductiecursus (Ontdek het Boek van Mormon)...");
    await importIntroLessons(client, introLessons, log);
  });

  log("Seeding Genees-vragen (Vliegende Versado)...");
  await inPhase("Genees-vragen", async () => {
    for (const bank of GENEES_BANKS) await importGeneesBank(client, bank, log);
  });

  log("Seeding De Slimste Heilige...");
  const alleskennerAll = [...alleskennerItems, ...generatedAlleskennerItems()];
  await inPhase("De Slimste Heilige", async () => {
    await importAlleskennerItems(client, alleskennerAll, log);
    await importAlleskennerTranslations(client, alleskennerTranslations(alleskennerAll), log);
  });

  log("Seeding achievements...");
  for (const def of achievementDefs) {
    await client.achievement.upsert({
      where: { slug: def.slug },
      update: { name: def.name, icon: def.icon, description: def.description },
      create: def,
    });
  }

  // Als laatste: het ophalen van de audio kan bij een eerste keer lang duren
  // (ruim een gigabyte per taal), en de content hierboven hoort daar niet op
  // te wachten. Hoofdstukken zonder kopie spelen intussen van de bron.
  if (scriptures) {
    log("Voorgelezen hoofdstukken spiegelen...");
    await inPhase("Audio spiegelen", () => mirrorChapterAudio(client, log));
  }

  log("Seed klaar.");
}
