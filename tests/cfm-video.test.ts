import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStudyDocument } from "../src/lib/studyContent/schema";

const ok = "https://assets.churchofjesuschrist.org/056947772199c0864a1af1fc39a2e0dfc32045ee-720p-nl.mp4";
const doc = (video: Record<string, unknown>) => ({ schemaVersion: 1, sections: [{ id: "s", blocks: [{ id: "video-v1", type: "video", title: "Titel", sources: [{ url: ok, width: 1280, height: 720 }], externalUrl: ok, ...video }] }] });

test("video-schema: een officiële MP4 op een toegestane host is geldig, ook binnen een lijst", () => {
  assert.ok(parseStudyDocument(doc({})));
  assert.ok(parseStudyDocument(doc({ sources: [{ url: "https://media2.ldscdn.org/assets/x/y.mp4", width: 640, height: 360 }], externalUrl: "https://media2.ldscdn.org/assets/x/y.mp4" })));
  assert.ok(parseStudyDocument({ schemaVersion: 1, sections: [{ id: "s", blocks: [{ id: "list-1", type: "list", ordered: false, items: [{ id: "item-1", content: [{ type: "text", text: "Kijk" }], blocks: [{ id: "video-v2", type: "video", title: "In een lijst", sources: [{ url: ok, width: 1280, height: 720 }], externalUrl: ok }] }] }] }] }));
});

test("video-schema: onveilige of niet-officiële bronnen worden geweigerd (geen iframe, geen vrije URL)", () => {
  const bad = [
    "http://assets.churchofjesuschrist.org/a.mp4",
    "https://evil.example/a.mp4",
    "https://assets.churchofjesuschrist.org.evil.example/a.mp4",
    "https://www.churchofjesuschrist.org/a.mp4",
    "https://assets.churchofjesuschrist.org:8443/a.mp4",
    "https://user:pw@assets.churchofjesuschrist.org/a.mp4",
    "https://assets.churchofjesuschrist.org/a.m3u8",
    "https://assets.churchofjesuschrist.org/a.mp4?token=1",
    "https://assets.churchofjesuschrist.org/a.mp4#t=10",
    "javascript:alert(1)",
    "https://assets.churchofjesuschrist.org/a b.mp4",
  ];
  for (const url of bad) {
    assert.throws(() => parseStudyDocument(doc({ sources: [{ url, width: 1280, height: 720 }] })), `bron ${url}`);
    assert.throws(() => parseStudyDocument(doc({ externalUrl: url })), `terugvallink ${url}`);
  }
  assert.throws(() => parseStudyDocument(doc({ sources: [] })));
  assert.throws(() => parseStudyDocument(doc({ sources: Array.from({ length: 5 }, () => ({ url: ok, width: 1, height: 1 })) })));
  assert.throws(() => parseStudyDocument(doc({ iframe: "https://www.youtube.com/embed/x" })), "geen onbekende velden (strict)");
  assert.throws(() => parseStudyDocument(doc({ title: "<iframe src=x></iframe>" })), "geen HTML in de titel");
});

test("videospeler: geen automatisch afspelen, geen iframe, lazy laden, bediening en foutstatus aanwezig", () => {
  const source = readFileSync("src/components/study/StudyVideo.tsx", "utf8");
  assert.match(source, /<video\b/);
  assert.match(source, /controls/);
  assert.match(source, /preload="none"/);
  assert.match(source, /playsInline/);
  assert.doesNotMatch(source, /autoPlay|autoplay/i);
  assert.doesNotMatch(source, /<iframe|dangerouslySetInnerHTML/);
  assert.match(source, /role="alert"/, "duidelijke foutstatus");
  assert.match(source, /rel="noopener noreferrer"/, "externe terugvallink");
  assert.match(source, /aspectRatio/, "vast 16:9-vlak (geen verspringende tekst)");
  const renderer = readFileSync("src/components/study/RichContentBlocks.tsx", "utf8");
  assert.match(renderer, /block\.type === "video"/);
  assert.match(renderer, /posterHidden/, "de poster staat in de speler en niet dubbel");
});

test("videoblok behoudt de annotatietekst van het vroegere verwijzingsblok (titel)", async () => {
  const { passageBlocks } = await import("../src/lib/annotations/contract");
  const document = parseStudyDocument(doc({ title: "De video" }));
  assert.deepEqual(passageBlocks(document as never, "s").map((b) => b.text), ["De video"]);
});
