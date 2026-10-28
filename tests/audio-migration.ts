import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BOOK_KEYS_BY_SLUG } from "../prisma/bookKeys";
import { seedBooks } from "../prisma/content";
import audio from "../prisma/bomAudio.json";
import { chapterTextHash } from "../src/lib/audioCheck";
import { prisma } from "../src/lib/db";
const url = new URL(process.env.AUDIO_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_audio_test" || process.env.DATABASE_URL !== url.href) throw new Error("Eigen audiorunner vereist");
const snapshotFile = join(process.env.AUDIO_TEST_ROOT!, "legacy-migration.json");
const snapshot = () => prisma.chapter.findMany({ where: { book: { contentCollectionId: "content_bom" }, audioUrl: { not: null } }, orderBy: { id: "asc" }, select: { id: true, audioUrl: true, audioHeadingStart: true, audioHeadingEnd: true, verses: { orderBy: { number: "asc" }, select: { id: true, text: true, audioStart: true } } } });
try {
  if (process.argv[2] === "prepare") {
    await prisma.book.create({ data: { id: "audio-before-book", slug: "audio-before", name: "Bestaande testinhoud", order: 999, contentCollectionId: "content_bom", key: "bofm/audio-before", chapters: { create: { id: "audio-before-chapter", number: 1, order: 0, audioUrl: "https://assets.churchofjesuschrist.org/existing.mp3", audioHeadingStart: 1, audioHeadingEnd: 2, verses: { create: { number: 1, text: "Bestaande synthetische tekst", audioStart: 3 } } } } } });
    assert.equal(audio.length, 205);
    // Werkelijke legacy-metadata en tekst, geen MP3-download of oefeningen; dit is de stand vóór beide migraties.
    for (const [order, book] of seedBooks.entries()) {
      const chapters = book.chapters.filter((c) => audio.some((e) => e.book === book.slug && e.chapter === c.number));
      if (!chapters.length) continue;
      await prisma.book.create({ data: { slug: book.slug, key: book.key ?? BOOK_KEYS_BY_SLUG[book.slug], name: book.name, order, contentCollectionId: "content_bom", chapters: { create: chapters.map((c) => {
        const entry = audio.find((e) => e.book === book.slug && e.chapter === c.number)!;
        return { number: c.number, order: c.number - 1, heading: c.heading, audioUrl: entry.url, audioHeadingStart: entry.headingStart, audioHeadingEnd: entry.headingEnd, verses: { create: c.verses.map((text, i) => ({ number: i + 1, text, audioStart: entry.verseStarts[i] })) } };
      }) } } });
    }
    assert.equal((await snapshot()).length, 206, "205 beschermde hoofdstukken plus de synthetische fixture");
    await writeFile(snapshotFile, JSON.stringify(await snapshot()));
    await prisma.user.create({ data: { id: "audio-before-user", email: "before@audio.invalid", handle: "AudioBefore", discriminator: "01", passwordHash: "unused", hintBalance: 47 } });
  } else {
    if (process.argv[2] === "verify-contentchecks") {
      const check = await prisma.chapterAudioCheck.findUniqueOrThrow({ where: { chapterId: "audio-before-chapter" } });
      assert.equal(check.status, "CURRENT");
      assert.equal(check.textHash, chapterTextHash(["Bestaande synthetische tekst"]));
      console.log("Contentbeheermigratie na Audio V2: bestaande audio krijgt de juiste controle zonder inhoudsmutatie.");
    }
    assert.deepEqual(await snapshot(), JSON.parse(await readFile(snapshotFile, "utf8")), "migratie wijzigt geen van de 205 legacy-hoofdstukken of vers-tijdcodes");
    if (process.argv[2] === "verify-contentchecks") {
      for (const c of await snapshot()) {
        const check = await prisma.chapterAudioCheck.findUniqueOrThrow({ where: { chapterId: c.id } });
        assert.equal(check.status, "CURRENT");
        assert.equal(check.textHash, chapterTextHash(c.verses.map((v) => v.text)));
      }
    }
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: "audio-before-chapter" }, include: { verses: true } });
    assert.equal(chapter.audioUrl, "https://assets.churchofjesuschrist.org/existing.mp3");
    assert.equal(chapter.verses[0].audioStart, 3); assert.equal(chapter.verses[0].text, "Bestaande synthetische tekst");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "audio-before-user" } })).hintBalance, 47);
    assert.equal(await prisma.audioRecording.count(), 0); assert.equal(await prisma.audioPublication.count(), 0);
    console.log("Audio-migratie: bestaande tekst, audio, tijdcodes en hintvoorraad ongewijzigd; nieuwe tabellen leeg.");
  }
} finally { await prisma.$disconnect(); }
