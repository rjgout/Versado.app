import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { clientTargetKey } from "../src/lib/annotations/clientContract";
import { blockSelector } from "../src/lib/annotations/domSelector";
import type { ReaderDocument } from "../src/lib/studyContent/readingPositionContract";
const body = {
  schemaVersion: 1,
  sections: [
    {
      id: "s",
      blocks: [
        {
          id: "p",
          type: "paragraph",
          content: [{ type: "text", text: " Je\u0301zus  😀 " }],
        },
      ],
    },
  ],
} as ReaderDocument;
test("volledig blok gebruikt dezelfde NFC- en codepuntnormalisatie als 4A", () => {
  const selector = blockSelector(body, "r", "s", "p");
  assert.equal(selector.exact, "Jézus 😀");
  assert.equal(selector.ranges[0].end, 7);
  assert.throws(() => blockSelector(body, "r", "missing", "p"));
});
test("client-targetidentiteit is identiek aan de servercanonicalisatie en onafhankelijk van quote/context", async () => {
  const selector = blockSelector(body, "r", "s", "p");
  const target = {
    type: "lesson" as const,
    lessonEditionId: "edition",
    revisionId: "r",
    selector,
  };
  const canonical =
    '{"lessonEditionId":"edition","ranges":[{"blockId":"p","end":7,"start":0}],"revisionId":"r","sectionAnchor":"s"}';
  assert.equal(
    await clientTargetKey(target),
    "lesson:" + createHash("sha256").update(canonical).digest("hex"),
  );
  assert.equal(
    await clientTargetKey({
      ...target,
      selector: { ...selector, exact: "ander" },
    }),
    await clientTargetKey(target),
  );
  assert.equal(
    await clientTargetKey({ type: "verse", verseId: "verse-1" }),
    "verse:verse-1",
  );
});

test("een blokactie gebruikt een native selectie alleen als zij het aangeklikte blok raakt; de algemene knop gebruikt altijd de selectie", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/components/annotations/StudyAnnotations.tsx", import.meta.url), "utf8");
  const open = source.slice(source.indexOf("function open("), source.indexOf("function select("));
  assert.match(open, /selectionTouchesBlock\(selection, section, blockId\)/);
  assert.match(open, /if \(relevant && selection!\.rangeCount !== 1\) throw Error\("SELECTION"\)/, "relevante ambigue selectie wordt geweigerd");
  assert.match(open, /blockSelector\(body, revisionId, section\.dataset\.studySection!, blockId\)/, "geen relevante selectie: het aangeklikte blok");
  assert.doesNotMatch(open, /!selection\.isCollapsed/, "geen blinde selectie meer, ook niet uit een ander blok");
  // de expliciete knop "Geselecteerde tekst annoteren" blijft de actuele selectie gebruiken
  const select = source.slice(source.indexOf("function select("), source.indexOf("useEffect("));
  assert.match(select, /selection\.getRangeAt\(0\)/);
  assert.doesNotMatch(select, /selectionTouchesBlock/);
});
