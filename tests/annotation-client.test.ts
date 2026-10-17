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
