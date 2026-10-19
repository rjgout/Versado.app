import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { parseStudyDocument } from "./schema";
import type { SnapshotItem } from "./fixtureAdapter";
import { FIXTURE_IMAGE } from "./fixtureAdapter";
import { studyDocumentInventory } from "./fixtureAdapter";

/**
 * Synthetische les met dezelfde opbouw als een officiële CFM-les (lestitel, persoonlijke studie, ideeën voor kinderen),
 * uitsluitend voor geïsoleerde tests en de browserproef. Geen officiële tekst; de weekperiode is de huidige week, zodat
 * "Stap voor stap" de les als actuele week kiest.
 */
/** Effen grijs PNG-beeld van de gevraagde afmetingen; de importer controleert de echte afmetingen van elke afbeelding. */
function solidPng(width: number, height: number): string {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bitdiepte
  header[9] = 0; // grijswaarden
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 180)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
const text = (value: string) => [{ type: "text" as const, text: value }];
const filler = (topic: number, part: number) =>
  `Synthetische studietekst ${topic}.${part}. Deze alinea is bewust lang genoeg om als een echte studiealinea te tellen, zodat de verdeling over zeven stappen en de leeslast gecontroleerd kunnen worden zonder officiële brontekst.`;

export function cfmPersonalFixtureItem(): SnapshotItem {
  const painting = solidPng(400, 300);
  const topics = [1, 2, 3, 4, 5].flatMap((n) => [
    { type: "paragraph" as const, id: `b-scripture_title${n}`, content: text(`Synthetisch ${n}:1–10`) },
    { type: "heading" as const, id: `b-topic${n}`, level: 3, content: text(`Synthetisch onderwerp ${n}`) },
    { type: "paragraph" as const, id: `b-p${n}a`, content: text(filler(n, 1)) },
    { type: "paragraph" as const, id: `b-p${n}b`, content: text(filler(n, 2)) },
    ...(n === 3
      ? [{ type: "figure" as const, id: "img-img2", mediaKey: "media-painting", width: 400, height: 300, alt: "Synthetisch schilderij", caption: text("Synthetisch schilderij, testkunstenaar") }]
      : []),
    ...(n === 2
      ? [{ type: "paragraph" as const, id: "b-figure3_p1", content: text("Wees creatief. Synthetische tip voor eigen studie, bewust een twijfelgeval in de bron.") }]
      : []),
    ...(n === 5
      ? [{ type: "paragraph" as const, id: "b-figure4_p1", content: text("Zie voor meer ideeën de Liahona en Voor de kracht van de jeugd van deze maand.") }]
      : []),
  ]);
  const body = {
    schemaVersion: 1,
    sections: [
      {
        id: "section-main",
        blocks: [
          { type: "paragraph", id: "b-reference1", content: text("Synthetische bronverwijzing") },
          { type: "paragraph", id: "b-short_reference1", content: text("Synthetische korte bronverwijzing") },
          { type: "figure", id: "img-img1", mediaKey: "media-diagram", width: 8, height: 8, alt: "Synthetisch testvlak" },
          { type: "paragraph", id: "b-figure1_p1", content: text("Synthetisch bijschrift") },
          { type: "paragraph", id: "b-title_number1", content: text("Synthetische week: ‘Test de zeven stappen’") },
          { type: "heading", id: "b-title1", level: 2, content: text("Synthetisch 1–10") },
          { type: "paragraph", id: "b-p0a", content: text(filler(0, 1)) },
          { type: "paragraph", id: "b-p0b", content: text(filler(0, 2)) },
          { type: "heading", id: "b-title2", level: 2, content: text("Studietips voor thuis en in de kerk") },
          ...topics,
          { type: "heading", id: "b-title8", level: 2, content: text("Ideeën voor onderwijs aan kinderen") },
          { type: "paragraph", id: "b-kids1", content: text("Synthetisch kinderidee dat niet bij de persoonlijke studie hoort.") },
        ],
      },
    ],
  };
  const parsed = parseStudyDocument(body);
  const rights = { holder: "Versado-testfixture", permission: "Synthetische fixture; uitsluitend geïsoleerde tests, geen officiële les." };
  // De huidige week (maandag t/m zondag, UTC) zodat de fixture vanzelf de actuele week is.
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const day = (offset: number) => new Date(monday.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return {
    schemaVersion: 1,
    title: "Synthetische CFM-les",
    body: parsed,
    sourceMetadata: { sourceKey: "fixture:cfm-lesson", name: "Gecontroleerde synthetische CFM-fixture" },
    rightsMetadata: rights,
    sourceKey: "fixture:cfm-lesson",
    slug: "synthetic-cfm-lesson",
    order: 0,
    startsOn: day(0),
    endsOn: day(6),
    media: [
      {
        mediaKey: "media-diagram",
        base64: FIXTURE_IMAGE,
        mimeType: "image/png",
        checksum: createHash("sha256").update(Buffer.from(FIXTURE_IMAGE, "base64")).digest("hex"),
        sourceKey: "fixture:diagram",
        rights,
      },
      {
        mediaKey: "media-painting",
        base64: painting,
        mimeType: "image/png" as const,
        checksum: createHash("sha256").update(Buffer.from(painting, "base64")).digest("hex"),
        sourceKey: "fixture:painting",
        rights,
      },
    ],
    expectedAnchors: studyDocumentInventory(parsed).anchors,
    expectedMedia: ["media-diagram", "media-painting"],
    expectedReferences: [],
    evidence: [],
  };
}
