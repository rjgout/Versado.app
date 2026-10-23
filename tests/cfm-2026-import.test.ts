import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  parseCfmLesson,
  cfmReferenceTarget,
  cfmSourceHash,
} from "../src/lib/studyContent/cfm2026Adapter";
import { cfmOldTestament2026NlManifest as manifest } from "../src/lib/studyContent/cfm2026Manifest";
import media from "../data/study-content/cfm-2026-nl/media-lock.json";
import lock from "../data/study-content/cfm-2026-nl/source-lock.json";
import { verifiedOfficialUrl } from "../src/lib/references/evidence";
import { parseOtbPassage, parseOtbPassageSet } from "../src/lib/references/otb";
import index from "../data/study-content/cfm-2026-nl/otb-index.json";
import {
  studyObjectHash,
  studyReleaseAllowed,
} from "../src/lib/studyContent/policy";
async function source(key: string) {
  return JSON.parse(
    await fs.readFile(
      `data/study-content/cfm-2026-nl/source/${key}.json`,
      "utf8",
    ),
  );
}
test("52 echte gepinde lessen behouden tekst, media, tabellen, volgorde en perioden", async () => {
  let blocks = 0,
    refs = 0,
    videos = 0,
    tables = 0,
    missingAlt = 0,
    embeddedFigures = 0,
    nestedLists = 0;
  assert.equal(manifest.lessons.length, 52);
  for (const lesson of manifest.lessons) {
    const raw = await fs.readFile(
      `data/study-content/cfm-2026-nl/source/${lesson.sourceKey}.json`,
      "utf8",
    );
    assert.equal(
      cfmSourceHash(raw),
      lock.lessons[lesson.sourceKey as keyof typeof lock.lessons],
    );
    const a = parseCfmLesson(lesson.sourceKey, JSON.parse(raw), media),
      b = parseCfmLesson(lesson.sourceKey, JSON.parse(raw), media);
    assert.equal(studyObjectHash(a.document), studyObjectHash(b.document));
    assert.ok(a.sourceText.length > 3000);
    assert.ok(a.documentText.length >= a.sourceText.length - 300);
    function walk(value: unknown, inList = false): void {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((v) => walk(v, inList));
        return;
      }
      const v = value as Record<string, unknown>;
      if (inList && v.type === "figure") embeddedFigures++;
      if (inList && v.type === "list") nestedLists++;
      Object.values(v).forEach((child) =>
        walk(child, inList || v.type === "list"),
      );
    }
    walk(a.document);
    blocks += a.inventory.blockCount;
    refs += a.inventory.references.length;
    videos += a.diagnostics.filter((d) => d.code === "VIDEO_EMBEDDED").length;
    tables += a.document.sections[0].blocks.filter(
      (b) => b.type === "table",
    ).length;
    missingAlt += a.diagnostics.filter(
      (d) => d.code === "MISSING_SOURCE_ALT",
    ).length;
    assert.equal(a.assets.length, a.inventory.figures.length);
  }
  assert.equal(blocks, 3200);
  // 95 officiële video's zijn sinds de ingebedde speler geen (extern geverifieerde) verwijzing meer maar een videoblok:
  // 3514 verwijzingen + 95 video's = de eerdere 3609.
  assert.equal(refs, 3514);
  assert.equal(videos, 95);
  assert.equal(tables, 10);
  assert.equal(missingAlt, 0);
  assert.equal(embeddedFigures, 56); // Twee bronafbeeldingen en 54 videoposters binnen lijstitems.
  assert.equal(nestedLists, 3);
});
test("OTB-doelen hebben bestaande canonieke hoofdstukken/verzen of een expliciete veilige diagnose", async () => {
  let valid = 0,
    blocked = 0,
    external = 0;
  for (const lesson of manifest.lessons) {
    const a = parseCfmLesson(
      lesson.sourceKey,
      await source(lesson.sourceKey),
      media,
    );
    for (const ref of a.inventory.references) {
      const single = parseOtbPassage(String(ref.target.sourceKey));
      const passages = single
        ? [single]
        : parseOtbPassageSet(String(ref.target.sourceKey));
      if (!passages) {
        if (verifiedOfficialUrl(ref.target.sourceKey)) external++;
        else blocked++;
        continue;
      }
      assert.equal(ref.target.language, "nl");
      assert.equal(ref.target.editionKey, "otb");
      if (
        passages.some((p) => {
          const c = index.chapters.find(
            (c) => c.bookKey === p.bookKey && c.chapter === p.chapter,
          );
          return (
            !c ||
            p.verses?.some((v) => !c.verses.includes(v)) ||
            (p.verses?.length ?? 0) > 40
          );
        })
      )
        blocked++;
      else valid++;
    }
  }
  assert.equal(valid, 1960);
  assert.equal(external, 1001, "1096 − 95 video's die nu een videoblok zijn");
  assert.equal(blocked, 553);
});
test("onbekende structuur, bronidentiteit en ontbrekende media stoppen; geen verzonnen vertaling", async () => {
  const s = await source("01");
  assert.throws(
    () =>
      parseCfmLesson(
        "01",
        { ...s, body: s.body + "<aside>Niet ondersteund</aside>" },
        media,
      ),
    /UNKNOWN_BLOCK/,
  );
  assert.throws(
    () => parseCfmLesson("01", { ...s, restricted: true }, media),
    /IDENTITY/,
  );
  assert.throws(
    () =>
      parseCfmLesson(
        "01",
        { ...s, attributes: { ...s.attributes, lang: "eng" } },
        media,
      ),
    /IDENTITY/,
  );
  assert.throws(() => parseCfmLesson("01", s, []), /MEDIA_MISSING/);
  const url = manifest.lessons[0].sourceUrl;
  assert.match(
    cfmReferenceTarget("../../scriptures/ot/gen/1.html", "Genesis 1–6", url)
      .sourceKey,
    /^otb-set:gen:1;gen:2;gen:3;gen:4;gen:5;gen:6$/,
  );
  assert.match(
    cfmReferenceTarget(
      "https://example.invalid/study/scriptures/ot/gen/1",
      "Genesis 1",
      url,
    ).sourceKey,
    /example.invalid/,
  );
  assert.equal(
    cfmReferenceTarget("../../scriptures/ot/ruth/1.html", "Ruth", url)
      .sourceKey,
    "otb-set:rut:1;rut:2;rut:3;rut:4",
  );
  assert.equal(
    cfmReferenceTarget("../../scriptures/ot/obad/1.html", "Obadja", url)
      .sourceKey,
    "otb:oba:1",
  );
  for (const label of ["Jesaja 9:5", "9:5"])
    assert.match(
      cfmReferenceTarget("../../scriptures/ot/isa/9.html?id=p6", label, url)
        .sourceKey,
      /^unverified-numbering:/,
    );
  assert.equal(
    parseOtbPassage(
      cfmReferenceTarget(
        "../../scriptures/ot/gen/1.html?id=p31",
        "Genesis 1:31–2:3",
        url,
      ).sourceKey,
    ),
    null,
  );
  assert.equal(
    cfmReferenceTarget(
      "https://example.invalid/study/scriptures/ot/gen/1",
      "Genesis 1",
      url,
    ).workKey,
    undefined,
  );
  assert.throws(
    () => cfmReferenceTarget("javascript:alert(1)", "Fout", url),
    /UNSAFE_URL/,
  );
  assert.deepEqual(
    parseOtbPassage(
      cfmReferenceTarget(
        "../../scriptures/ot/ps/119.html?id=p105,p140#p105",
        "Psalmen 119:105, 140",
        url,
      ).sourceKey,
    ),
    { bookKey: "psa", chapter: 119, verses: [105, 140] },
  );
  assert.equal(studyReleaseAllowed("cfm-2026-nl-v1"), true);
});

test("video's: officiële MP4-bronnen op exacte hosts, standaard 720p, geen iframe of vrije URL", async () => {
  const { CFM_VIDEO_HOSTS } = await import("../src/lib/studyContent/cfmReferencePolicy");
  const { loadCfmLesson } = await import("../src/lib/studyContent/cfm2026Import");
  let count = 0;
  for (const lesson of manifest.lessons) {
    const parsed = await loadCfmLesson(lesson.sourceKey);
    const found: Array<{ id: string; sources: Array<{ url: string; width: number }>; externalUrl: string }> = [];
    (function walk(value: unknown) {
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      if (row.type === "video") found.push(row as never);
      for (const child of Object.values(row)) walk(child);
    })(parsed.document);
    for (const video of found) {
      count += 1;
      assert.ok(video.sources.length >= 1 && video.sources.length <= 4);
      for (const source of video.sources) {
        const url = new URL(source.url);
        assert.equal(url.protocol, "https:");
        assert.ok(CFM_VIDEO_HOSTS.includes(url.hostname), source.url);
        assert.match(url.pathname, /\.mp4$/);
      }
      assert.equal(video.externalUrl, video.sources[0].url, "de officiële terugvallink is de standaardbron");
      // De standaardbron is 720p (of de grootste als er geen 720p is), niet de zwaarste en niet de kleinste.
      assert.ok(video.sources[0].width === 1280 || video.sources.every((s) => s.width <= video.sources[0].width), `${lesson.sourceKey}: ${video.id}`);
    }
  }
  assert.equal(count, 95);
});
