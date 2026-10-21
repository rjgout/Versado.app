// Welke database de cursusscripts daadwerkelijk raken: alleen host, poort en databasenaam, nooit gebruikersnaam, wachtwoord of query.
// Zo is vóór elke controle of herstelrun ondubbelzinnig vast te stellen of de verbinding naar productie of een testdatabase wijst.
export function databaseTarget(): { host: string; port: string; database: string } {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is niet gezet; de cursusscripts draaien nooit op een raadbare standaardverbinding.");
  const url = new URL(raw);
  return { host: url.hostname, port: url.port || "5432", database: decodeURIComponent(url.pathname.replace(/^\//, "")) };
}
