/** De generator krijgt een tekstexport, nooit databasecredentials. Alleen expliciete beheer-CLI. */
import fs from "node:fs/promises";
import { createPrismaClient } from "../../src/lib/db";
import { chapterSourceHash, sha256 } from "../../src/lib/audio/contract";
const output = process.argv[2];
if (!output) throw new Error("Geef een nieuw uitvoerbestand voor de tekstexport op.");
const db = createPrismaClient();
try {
 const chapters = await db.chapter.findMany({ where: { book: { contentCollection: { work: { in: ["bofm", "dc-testament", "pgp"] } } } }, include: { book: { include: { contentCollection: true } }, verses: { orderBy: { number: "asc" } } }, orderBy: [{ bookId: "asc" }, { number: "asc" }] });
 const targets = chapters.map((chapter) => { const c=chapter.book.contentCollection; return { collectionId:c.id,work:c.work,editionKey:c.editionKey,language:c.language,target:{kind:"CHAPTER",bookKey:chapter.book.key,chapterNumber:chapter.number},sourceHash:chapterSourceHash(chapter),heading:chapter.heading,segments:chapter.verses.map((v)=>({id:v.id,kind:"VERSE",number:v.number,text:v.text,sourceHash:sha256(v.text)})) }; });
 await fs.writeFile(output,JSON.stringify({schemaVersion:1,targets},null,2)+"\n",{flag:"wx",mode:0o600});
 console.log(`${targets.length} hoofdstukankers geëxporteerd; geen content of publicatie gewijzigd.`);
} finally { await db.$disconnect(); }
