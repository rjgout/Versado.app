import test from "node:test";
import assert from "node:assert/strict";
import { dailyTextIndex, lessonDailyQuotes } from "../src/lib/dailyTextRules";
import { parseStudyDocument } from "../src/lib/studyContent/schema";

test("dagkeuze is stabiel en blijft binnen het werkelijke aanbod", () => {
  for (let day = 1; day <= 31; day++) for (const total of [0, 1, 7, 6600]) {
    const key = `2026-10-${String(day).padStart(2, "0")}`;
    const index = dailyTextIndex(key, total);
    assert.equal(index, dailyTextIndex(key, total));
    assert.ok(index >= 0 && index < Math.max(total, 1));
  }
  assert.ok(new Set(Array.from({ length: 7 }, (_, i) => dailyTextIndex(`2026-10-${19+i}`, 7))).size > 1);
});
test("lescitaat is letterlijk, volledig en kiest geen vraag, afbeelding of bibliografie", () => {
  const paragraph = "Een volledige korte alinea uit de gepubliceerde les, die letterlijk zo in de bron staat.";
  const quote = "Dit is het werkelijke citaat in de les; dat heeft voorrang boven een gewone studiealinea.";
  const block = (type: "quote"|"paragraph", id: string, text: string) => ({ type, id, content: [{ type: "text", text }] });
  const doc = (blocks: unknown[]) => parseStudyDocument({ schemaVersion: 1, sections: [{ id: "body", blocks }] });
  assert.deepEqual(lessonDailyQuotes(doc([block("paragraph", "p", paragraph), block("quote", "q", quote)])), [{ anchor: "q", text: quote }]);
  assert.deepEqual(lessonDailyQuotes(doc([block("paragraph", "p", paragraph)])), [{ anchor: "p", text: paragraph }]);
  assert.deepEqual(lessonDailyQuotes(doc([block("paragraph", "b-reference1", paragraph), block("quote", "long", "A".repeat(601)), block("paragraph", "question", `${paragraph}?`), block("paragraph", "short", "te kort")])), []);
});
