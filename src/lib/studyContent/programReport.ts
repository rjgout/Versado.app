import type { ProgramReview } from "./programReview";

// Controleverslag voor een gezamenlijke beoordeling buiten de beheerpagina. Alleen inhoudsidentiteiten en
// controleresultaten: geen gebruikersgegevens, sessies, tokens of geheimen. Het verslag zegt nadrukkelijk dat
// er (nog) geen menselijke of AI-beoordeling heeft plaatsgevonden: het is een automatische voorcontrole.

const NOT_REVIEWED = "NIET BEOORDEELD: dit verslag is automatisch samengesteld uit de opgeslagen gegevens en de vastgelegde controlelijsten. Het is niet door een beheerder of AI inhoudelijk beoordeeld; de server herhaalt bij publicatie alle controles per les.";

const cell = (value: unknown) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const ISSUE: Record<string, string> = {
  CATALOGUE: "De lessenset wijkt af van het officiële CFM 2026-manifest (lesidentiteiten, volgorde, collectie of uitgave).",
  CONTENT: "De opgeslagen inhoud komt niet overeen met zijn vastgelegde identiteit.",
  IMPORT: "Geen afgeronde import voor dit concept.",
  IMPORT_CLOSED: "De importbron mag niet gepubliceerd worden.",
  SOURCE: "De bronles komt niet exact overeen met de vastgelegde, gecontroleerde bron.",
  MEDIA: "Afbeelding ontbreekt of is niet bewezen",
  ALT: "Afbeelding(en) zonder alttekst",
  REFERENCE_UNKNOWN: "Verwijzing is onbekend of onveilig",
  REFERENCE_UNPROVEN: "Verwijzing is niet opnieuw bewezen",
  REFERENCE_MISMATCH: "Verwijzing wijkt af van de vastgelegde controle",
  INCOMPLETE: "Revisie, media- of verwijzingsaudit is onvolledig.",
};
const issueText = (issue: { code: string; ref?: string; count?: number }) => `${ISSUE[issue.code] ?? issue.code}${issue.ref ? `: ${issue.ref}` : ""}${issue.count ? ` (${issue.count})` : ""}`;
const STATUS: Record<string, string> = { published: "Gepubliceerd", ready: "Gereed voor publicatie", blocked: "Geblokkeerd", missing: "Ontbreekt" };

export function programReportJson(review: ProgramReview) {
  return {
    reviewStatus: "NOT_REVIEWED" as const,
    statement: NOT_REVIEWED,
    ...review,
  };
}

export function programReportMarkdown(review: ProgramReview): string {
  const lines: string[] = [];
  const out = (line = "") => lines.push(line);
  out(`# Controleverslag studieprogramma: ${review.name}`);
  out();
  out(`> ${NOT_REVIEWED}`);
  out();
  out("## Identiteit van de gecontroleerde set");
  out();
  out(`- Collectie-ID: \`${review.collectionId}\``);
  out(`- Werk / uitgave / taal: ${review.work ?? "—"} / ${review.editionKey ?? "—"} / ${review.language}`);
  out(`- Bron: ${review.sourceName ?? "—"}${review.sourceUrl ? ` (${review.sourceUrl})` : ""}`);
  out(`- Licentie/rechten: ${review.licenseName ?? "—"}`);
  out(`- Importadapter en bronversie: ${review.adapter ?? "—"} / ${review.sourceVersion ?? "—"}`);
  out(`- Beoordelingstoken (identiteit van alle revisies en controlelijsten): \`${review.reviewToken}\``);
  if (review.controlLists.referenceReview) out(`- Gecontroleerde verwijzingslijst (hash): \`${review.controlLists.referenceReview}\``);
  if (review.controlLists.sourceLock) out(`- Bronvergrendeling (hash): \`${review.controlLists.sourceLock}\``);
  out(`- Publicatiestatus collectie: ${review.publicationState}; zichtbaar voor gebruikers: ${review.visibleToUsers ? "ja" : "nee"}`);
  out(`- Samengesteld op: ${review.generatedAt}`);
  out();
  out("## Samenvatting");
  out();
  out(`- Lessen: ${review.expected} verwacht, ${review.imported} geïmporteerd, ${review.published} gepubliceerd, ${review.ready} gereed, ${review.blocked} geblokkeerd, ${review.missing} ontbrekend`);
  out(`- Afbeeldingen: ${review.totals.mediaReady} van ${review.totals.figures} bewezen; ${review.totals.mediaMissing} ontbrekend; ${review.totals.altMissing} zonder alttekst`);
  out(`- Verwijzingen: ${review.totals.references} totaal; ${review.totals.referencesVerified} bewezen; ${review.totals.displayOnly} bekende, niet-klikbare (exact in de vastgelegde lijst); blokkerende punten in totaal: ${review.totals.blocking}`);
  out();
  const issues = review.lessons.filter((l) => l.issues.length);
  out("## Uitzonderingen en blokkerende fouten");
  out();
  if (!issues.length) out("Geen.");
  for (const lesson of issues) {
    out(`### ${lesson.order}. ${lesson.title} (${lesson.sourceKey})`);
    for (const issue of lesson.issues) out(`- [${issue.code}] ${issueText(issue)}`);
    out();
  }
  out("## Lessen");
  out();
  out("| Nr | Bronsleutel | Titel | Editie-ID | Revisie-ID | Rev. | Inhoudshash | Status | Blokken | Afb. bewezen/totaal | Zonder alttekst | Verwijzingen bewezen/bekend niet-klikbaar/blokkerend/totaal | Importrun |");
  out("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const l of review.lessons)
    out(`| ${l.order} | ${cell(l.sourceKey)} | ${cell(l.title)} | ${l.editionId} | ${l.revisionId ?? "—"} | ${l.revisionNumber ?? "—"} | ${l.contentHash ?? "—"} | ${STATUS[l.status]} | ${l.blocks} | ${l.media.ready}/${l.media.figures} | ${l.media.altMissing} | ${l.references.verified}/${l.references.displayOnly}/${l.references.blocking}/${l.references.total} | ${l.importRunId ?? "—"} |`);
  out();
  const known = review.lessons.filter((l) => l.displayOnlyKeys.length);
  out("## Bekende, niet-klikbare verwijzingen (exact in de vastgelegde lijst)");
  out();
  if (!known.length) out("Geen in nog te publiceren lessen.");
  for (const l of known) out(`- Les ${l.order} (${l.sourceKey}): ${l.displayOnlyKeys.length} verwijzing(en): ${l.displayOnlyKeys.join(", ")}`);
  out();
  return lines.join("\n");
}
