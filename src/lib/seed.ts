import { PrismaClient } from "@/generated/prisma/client";
import { seedBooks } from "../../prisma/content";
import { importBooks } from "../../prisma/importContent";
import { importChapterAudio, type ChapterAudioSeed } from "../../prisma/importAudio";
import { mirrorChapterAudio } from "./audioMirror";
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
import type { SeedBook } from "../../prisma/content";
import {
  BOM_EN_COLLECTION_ID,
  BOM_ES_COLLECTION_ID,
  BOM_DE_COLLECTION_ID,
  BOM_FR_COLLECTION_ID,
  BOM_COLLECTION_ID,
  DC_COLLECTION_ID,
  DC_EN_COLLECTION_ID,
  PGP_COLLECTION_ID,
  PGP_EN_COLLECTION_ID,
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
// Begintijden per vers in de voorgelezen hoofdstukken per uitgave (berekend
// met scripts/bom-audio). De Nederlandse staat hierboven los, omdat die bij
// de standaardcollectie hoort die altijd bestaat.
const audioByCollection: Partial<Record<string, ChapterAudioSeed[]>> = {
  [BOM_EN_COLLECTION_ID]: bomAudioEn as ChapterAudioSeed[],
  [BOM_DE_COLLECTION_ID]: bomAudioDe as ChapterAudioSeed[],
  [BOM_FR_COLLECTION_ID]: bomAudioFr as ChapterAudioSeed[],
  [BOM_ES_COLLECTION_ID]: bomAudioEs as ChapterAudioSeed[],
};

export async function runSeed(
  client: PrismaClient,
  log: (msg: string) => void = console.log,
  progress?: (progress: OtbImportProgress) => void,
): Promise<void> {
  log("Seeding boeken, hoofdstukken, verzen en oefeningen...");
  await inPhase("Boeken", () => importBooks(client, seedBooks, log));
  await inPhase("Voorgelezen hoofdstukken", () => importChapterAudio(client, bomAudio as ChapterAudioSeed[], BOM_COLLECTION_ID, log));

  // De OTB-import staat los van de cursussen: hij gebruikt geen syncCourses en
  // draait pas na de eerste cursussynchronisatie, maar een fout daarin blijft
  // een Bijbelfout en een cursusfout hierboven blijft een cursusfout.
  log("Open Translation Bible voorbereiden...");
  await inPhase("Bijbel (OTB)", async () => {
    const otbSource = await preparePinnedOtbSource(log);
    await importOtbTrial(client, otbSource, log, progress);
  });

  // Leer en Verbonden en de Parel van Grote Waarde, en de Engelse uitgaven
  // van alle drie, elk in een eigen collectie. Alleen als die collectie
  // bestaat (migraties 20260924200000_dc_pgp_collections en
  // 20260925120000_english_editions), anders zou importBooks ze bij het
  // Boek van Mormon zetten. De taal van de collectie bepaalt de taal van de
  // gegenereerde oefeningen en hints.
  for (const [collectionId, books, label] of [
    [DC_COLLECTION_ID, dcContent as SeedBook[], "Leer en Verbonden"],
    [PGP_COLLECTION_ID, pgpContent as SeedBook[], "Parel van Grote Waarde"],
    [BOM_EN_COLLECTION_ID, bomContentEn as SeedBook[], "Book of Mormon (Engels)"],
    [BOM_ES_COLLECTION_ID, bomContentEs as SeedBook[], "Libro de Mormón (Spaans)"],
    [BOM_DE_COLLECTION_ID, bomContentDe as SeedBook[], "Das Buch Mormon (Duits)"],
    [BOM_FR_COLLECTION_ID, bomContentFr as SeedBook[], "Le Livre de Mormon (Frans)"],
    [DC_EN_COLLECTION_ID, dcContentEn as SeedBook[], "Doctrine and Covenants (Engels)"],
    [PGP_EN_COLLECTION_ID, pgpContentEn as SeedBook[], "Pearl of Great Price (Engels)"],
  ] as const) {
    if (!(await client.contentCollection.findUnique({ where: { id: collectionId }, select: { id: true } }))) continue;
    log(`Seeding ${label}...`);
    await inPhase(`Boeken (${label})`, async () => {
      await importBooks(client, books, log, collectionId);
      const audio = audioByCollection[collectionId];
      if (audio) await importChapterAudio(client, audio, collectionId, log);
    });
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
  log("Voorgelezen hoofdstukken spiegelen...");
  await inPhase("Audio spiegelen", () => mirrorChapterAudio(client, log));

  log("Seed klaar.");
}
