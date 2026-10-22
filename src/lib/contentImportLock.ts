import { Client } from "pg";

// Eén contentimport tegelijk, ook tussen processen (de adminknop in de app en `npm run db:seed` in een terminal). Een sessie-advisory-lock
// op een eigen databaseverbinding: hij vervalt vanzelf als het proces of de verbinding wegvalt, dus een gecrashte import laat nooit een
// "bezet"-vlag achter, en hij houdt geen transactie of tabelvergrendeling open.
const CONTENT_IMPORT_LOCK_KEY = 726_540_101;

export class ContentImportBusyError extends Error {
  constructor() {
    super("Er loopt al een contentimport. Wacht tot die klaar is en probeer het daarna opnieuw.");
    this.name = "ContentImportBusyError";
  }
}

/** Voert `work` uit terwijl de importlock vastgehouden wordt; geeft ContentImportBusyError als iemand anders hem heeft. */
export async function withContentImportLock<T>(work: () => Promise<T>, connectionString: string | undefined = process.env.DATABASE_URL): Promise<T> {
  // Zonder bekende verbinding (bijvoorbeeld een test met alleen een client) kan er niet gelocked worden; de in-memory jobbewaking van de
  // adminknop blijft dan het enige slot.
  if (!connectionString) return work();
  const lock = new Client({ connectionString, connectionTimeoutMillis: 15_000 });
  await lock.connect();
  try {
    const { rows } = await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [CONTENT_IMPORT_LOCK_KEY]);
    if (!rows[0]?.ok) throw new ContentImportBusyError();
    try {
      return await work();
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1)", [CONTENT_IMPORT_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await lock.end().catch(() => undefined);
  }
}
