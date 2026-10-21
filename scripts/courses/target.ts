// Welke database de cursusscripts daadwerkelijk raken. De verbinding wordt hier één keer vastgesteld, vóór er een Prisma-client bestaat, en
// dezelfde URL gaat daarna expliciet naar createPrismaClient({ url }): de getoonde en bevestigde database is dus per constructie de database
// waarmee verbonden wordt. Getoond worden alleen host, poort en databasenaam, nooit gebruikersnaam, wachtwoord of query.

export interface DatabaseLabel {
  host: string;
  port: string;
  database: string;
}

export interface ResolvedDatabase {
  /** De volledige verbindings-URL, uitsluitend bedoeld voor createPrismaClient; nooit tonen of loggen. */
  url: string;
  label: DatabaseLabel;
  /** Naam van de omgevingsvariabele waaruit de verbinding komt (geen waarde), zodat de operator ziet welke verbinding gebruikt wordt. */
  source: "COURSES_READONLY_DATABASE_URL" | "COURSES_REPAIR_DATABASE_URL" | "DATABASE_URL";
}

export type ConnectionMode = "read" | "apply";

/**
 * Bepaalt de databaseverbinding, gescheiden naar doel:
 *  - "read" (audit en dry-run): COURSES_READONLY_DATABASE_URL, een aparte PostgreSQL-gebruiker met alleen leesrechten (zie
 *    scripts/courses/readonly-role.sql); ontbreekt die, dan DATABASE_URL.
 *  - "apply" (--apply): COURSES_REPAIR_DATABASE_URL; ontbreekt die, dan DATABASE_URL. De alleen-lezen variabele wordt hier NOOIT gebruikt, en
 *    een schrijfverbinding die gelijk is aan de alleen-lezen verbinding wordt geweigerd.
 * Ontbreekt de DATABASE_URL, dan wordt zoals in src/lib/db.ts het lokale `.env` (van de huidige map) ingelezen. Zonder verbinding: een duidelijke
 * fout, geen raadbare standaardverbinding. Een lege variabele telt als niet gezet.
 */
export function resolveDatabase(
  env: Record<string, string | undefined> = process.env,
  loadEnvFile: () => void = () => process.loadEnvFile(),
  mode: ConnectionMode = "read"
): ResolvedDatabase {
  const specific = mode === "read" ? "COURSES_READONLY_DATABASE_URL" : "COURSES_REPAIR_DATABASE_URL";
  if (!env[specific] && !env.DATABASE_URL) {
    try {
      loadEnvFile();
    } catch {
      // Geen .env: valt hieronder terug op de foutmelding.
    }
  }
  const source = env[specific] ? specific : "DATABASE_URL";
  const raw = env[source];
  if (!raw) {
    throw new Error(
      mode === "read"
        ? "DATABASE_URL is niet gezet (en ook COURSES_READONLY_DATABASE_URL niet, en er is geen lokaal .env met DATABASE_URL); de cursusscripts draaien nooit op een raadbare standaardverbinding."
        : "Geen schrijfverbinding voor --apply: zet COURSES_REPAIR_DATABASE_URL (of DATABASE_URL). De alleen-lezen verbinding wordt hiervoor nooit gebruikt."
    );
  }
  if (mode === "apply" && env.COURSES_READONLY_DATABASE_URL && raw === env.COURSES_READONLY_DATABASE_URL) {
    throw new Error("De schrijfverbinding voor --apply is gelijk aan de alleen-lezen verbinding; gebruik een aparte COURSES_REPAIR_DATABASE_URL.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${source} is geen geldige verbindings-URL.`);
  }
  return { url: raw, source, label: { host: url.hostname, port: url.port || "5432", database: decodeURIComponent(url.pathname.replace(/^\//, "")) } };
}

/** De identiteit zoals de operator die bevestigt: `host:poort/databasenaam`. Dezelfde servernaam kan op meerdere servers voorkomen, dus de naam alleen volstaat niet. */
export function formatDatabaseIdentity(label: DatabaseLabel): string {
  return `${label.host}:${label.port}/${label.database}`;
}

/** Exacte vergelijking met de bevestiging van de operator; geen normalisatie, geen gedeeltelijke overeenkomst. */
export function confirmsDatabaseIdentity(label: DatabaseLabel, confirmation: string | undefined): boolean {
  return confirmation !== undefined && confirmation === formatDatabaseIdentity(label);
}
