import type { StudyRevisionInput } from "../../src/lib/studyContent/revisions";
/** Alleen synthetische semantiek; nooit gepubliceerd lesmateriaal of Schriftuurverzen. */
export function studyRevisionFixture(): StudyRevisionInput {
  const content = [{ type: "text", text: "Synthetische testtekst — é 日本語 العربية", marks: ["strong"] }];
  return { schemaVersion: 1, title: "Synthetische testles", sourceMetadata: { sourceKey: "synthetic:lesson" },
    rightsMetadata: { holder: "Testfixture", permission: "Uitsluitend lokale tests" }, body: { schemaVersion: 1, sections: [{ id: "section-intro", blocks: [
      { id: "block-heading", type: "heading", level: 2, content },
      { id: "block-paragraph", type: "paragraph", content: [...content, { type: "link", text: "Testlink", href: "https://example.invalid/path" }] },
      { id: "block-list", type: "list", ordered: false, items: [{ id: "item-first", content, children: [{ id: "item-child", content }] }] },
      { id: "block-quote", type: "quote", content, attribution: [{ type: "text", text: "Testauteur" }] },
      { id: "block-question", type: "question", content },
      { id: "block-assignment", type: "assignment", content, items: [{ id: "item-task", content }] },
      { id: "block-figure", type: "figure", mediaKey: "media-synthetic", alt: "Synthetische afbeelding", width: 640, height: 480, caption: content },
      { id: "block-reference", type: "reference", label: "Synthetische verwijzing", target: { sourceKey: "synthetic:reference", workKey: "test-study", editionKey: "official", language: "nl", externalUrl: "https://example.invalid/reference" } },
      { id: "block-divider", type: "divider" },
    ] }] } };
}
