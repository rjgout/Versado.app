// Alleen een lokaal aangeleverde, gepinde OTB-snapshot lezen. Geen database.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseOtbChapter } from "../otb/chapterParser";
import { OTB_BOOK_KEY_BY_NUMBER } from "../otb/bookMapping";
import sourceLock from "../otb/source-lock.json";
const root = process.argv[process.argv.indexOf("--source") + 1];
if (!process.argv.includes("--source") || !root)
  throw Error("Geef --source met de Nederlandse OTB-map.");
const tree = JSON.parse(
  await fs.readFile(path.join(root, "source-tree.json"), "utf8"),
) as { commit: string; files: Array<{ path: string; sha: string }> };
if (tree.commit !== sourceLock.upstreamCommit) throw Error("OTB_COMMIT");
const chapters = [];
for (const file of tree.files) {
  if (!/^\d{2}\.[^/]+\/json\/[^/]+\.json$/.test(file.path))
    throw Error("OTB_SOURCE_PATH");
  const bytes = await fs.readFile(path.join(root, file.path));
  if (
    createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex") !== file.sha
  )
    throw Error("OTB_BLOB_HASH");
  const parsed = parseOtbChapter(JSON.parse(bytes.toString("utf8")), file.path);
  if (parsed.issues.length) throw Error("OTB_SOURCE_CONTENT");
  chapters.push({
    bookKey: OTB_BOOK_KEY_BY_NUMBER.get(Number(file.path.slice(0, 2)))!,
    chapter: parsed.chapter,
    verses: [...parsed.verses.keys()],
    sourceFile: file.path,
    sourceBlob: file.sha,
  });
}
if (
  chapters.length !== 929 ||
  new Set(chapters.map((c) => c.bookKey)).size !== 39
)
  throw Error("OTB_SOURCE_COMPLETENESS");
await fs.writeFile(
  "data/study-content/cfm-2026-nl/otb-index.json",
  JSON.stringify(
    {
      workKey: "old-testament",
      editionKey: "otb",
      language: "nl",
      upstreamCommit: sourceLock.upstreamCommit,
      chapters,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    books: 39,
    chapters: chapters.length,
    verses: chapters.reduce((n, c) => n + c.verses.length, 0),
    databaseQueried: false,
  }),
);
