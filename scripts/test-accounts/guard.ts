// Beveiliging van de testaccountvoorziening. Een omgevingsvariabele alleen is geen productiebeveiliging, dus de toestemming zit in
// drie onafhankelijke, controleerbare feiten: (1) de database zelf draagt een door de eigenaar gezet testmerk (databasecommentaar,
// niet via de app of een migratie te zetten), (2) de databasenaam is een test-/devnaam, (3) de canonieke app-URL is geen
// productiedomein. Daarbovenop komen de letterlijke databasebevestiging en --apply (zie het script).

/** Het merk dat de eigenaar eenmalig op de testdatabase zet: COMMENT ON DATABASE <naam> IS 'versado-test-omgeving'; */
export const TEST_DATABASE_MARK = "versado-test-omgeving";
/** Productiedomeinen: nooit een doel, ook niet met alle andere bevestigingen. */
export const PRODUCTION_HOSTS = ["versado.app", "www.versado.app", "jehova.app", "www.jehova.app"] as const;

export interface GuardFacts { database: string; databaseComment: string | null; appUrl: string | undefined; userCount: number }

/** Geeft de eerste weigeringsreden terug, of null als alle voorwaarden gelden. */
export function refusalReason(facts: GuardFacts): string | null {
  if (facts.databaseComment !== TEST_DATABASE_MARK) return `de database draagt het testmerk niet. De eigenaar zet het eenmalig op een testdatabase: COMMENT ON DATABASE "${facts.database}" IS '${TEST_DATABASE_MARK}';`;
  if (!/(?:^|[_-])(?:test|dev)(?:$|[_-])/i.test(facts.database)) return "de databasenaam bevat geen los 'test' of 'dev' (bv. versado_test).";
  if (facts.appUrl) {
    let host: string;
    try { host = new URL(facts.appUrl).hostname.toLowerCase(); } catch { return "APP_URL is ongeldig."; }
    if ((PRODUCTION_HOSTS as readonly string[]).includes(host)) return `APP_URL (${host}) is een productiedomein.`;
  }
  // createAccount maakt de allereerste gebruiker automatisch beheerder; een lege database mag nooit een testaccount als beheerder krijgen.
  if (facts.userCount === 0) return "de database heeft nog geen gebruikers (een testaccount zou beheerder worden). Registreer eerst het echte testaccount van de eigenaar.";
  return null;
}
