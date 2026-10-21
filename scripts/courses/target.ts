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
}

/**
 * Bepaalt de databaseverbinding. Een expliciete DATABASE_URL gaat voor; ontbreekt die, dan wordt zoals in src/lib/db.ts het lokale `.env`
 * (van de huidige map) ingelezen. Zonder beide: een duidelijke fout, geen raadbare standaardverbinding.
 */
export function resolveDatabase(
  env: Record<string, string | undefined> = process.env,
  loadEnvFile: () => void = () => process.loadEnvFile()
): ResolvedDatabase {
  if (!env.DATABASE_URL) {
    try {
      loadEnvFile();
    } catch {
      // Geen .env: valt hieronder terug op de foutmelding.
    }
  }
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is niet gezet (en er is geen lokaal .env met DATABASE_URL); de cursusscripts draaien nooit op een raadbare standaardverbinding.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is geen geldige verbindings-URL.");
  }
  return { url: raw, label: { host: url.hostname, port: url.port || "5432", database: decodeURIComponent(url.pathname.replace(/^\//, "")) } };
}

/** De identiteit zoals de operator die bevestigt: `host:poort/databasenaam`. Dezelfde servernaam kan op meerdere servers voorkomen, dus de naam alleen volstaat niet. */
export function formatDatabaseIdentity(label: DatabaseLabel): string {
  return `${label.host}:${label.port}/${label.database}`;
}

/** Exacte vergelijking met de bevestiging van de operator; geen normalisatie, geen gedeeltelijke overeenkomst. */
export function confirmsDatabaseIdentity(label: DatabaseLabel, confirmation: string | undefined): boolean {
  return confirmation !== undefined && confirmation === formatDatabaseIdentity(label);
}
