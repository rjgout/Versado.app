import assert from "node:assert/strict";
import { chapterTextHash } from "../src/lib/audioCheck";
import { prisma } from "../src/lib/db";
const url = new URL(process.env.AUDIO_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_audio_test" || process.env.DATABASE_URL !== url.href) throw new Error("Eigen audiorunner vereist");
try {
  if (process.argv[2] === "prepare") {
    await prisma.book.create({ data: { id: "audio-before-book", slug: "audio-before", name: "Bestaande testinhoud", order: 999, contentCollectionId: "content_bom", key: "bofm/audio-before", chapters: { create: { id: "audio-before-chapter", number: 1, order: 0, audioUrl: "https://assets.churchofjesuschrist.org/existing.mp3", audioHeadingStart: 1, audioHeadingEnd: 2, verses: { create: { number: 1, text: "Bestaande synthetische tekst", audioStart: 3 } } } } } });
    await prisma.user.create({ data: { id: "audio-before-user", email: "before@audio.invalid", handle: "AudioBefore", discriminator: "01", passwordHash: "unused", hintBalance: 47 } });
  } else {
    if (process.argv[2] === "verify-contentchecks") {
      const check = await prisma.chapterAudioCheck.findUniqueOrThrow({ where: { chapterId: "audio-before-chapter" } });
      assert.equal(check.status, "CURRENT");
      assert.equal(check.textHash, chapterTextHash(["Bestaande synthetische tekst"]));
      console.log("Contentbeheermigratie na Audio V2: bestaande audio krijgt de juiste controle zonder inhoudsmutatie.");
    }
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: "audio-before-chapter" }, include: { verses: true } });
    assert.equal(chapter.audioUrl, "https://assets.churchofjesuschrist.org/existing.mp3");
    assert.equal(chapter.verses[0].audioStart, 3); assert.equal(chapter.verses[0].text, "Bestaande synthetische tekst");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: "audio-before-user" } })).hintBalance, 47);
    assert.equal(await prisma.audioRecording.count(), 0); assert.equal(await prisma.audioPublication.count(), 0);
    console.log("Audio-migratie: bestaande tekst, audio, tijdcodes en hintvoorraad ongewijzigd; nieuwe tabellen leeg.");
  }
} finally { await prisma.$disconnect(); }
