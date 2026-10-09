import { createHash, createHmac, timingSafeEqual } from "crypto";
import { isNotifyCategory, type NotifyCategory } from "@/lib/notifyCategories";

// Uitschrijflinks in notificatiemails. Bewust een ondertekend, stateloos token en geen
// databaserij zoals AuthToken (src/lib/authTokens.ts): een uitschrijflink hoort jaren
// bruikbaar te blijven, mag meerdere keren geopend worden (mailscanners, een tweede klik)
// en moet zonder login werken. Wat er hetzelfde is als bij authTokens: een sterk geheim
// dat niet te raden is, en er staat niets in dat een aanvaller kan aanpassen.
//
// Formaat: `u1.<userId>.<categorie>.<handtekening>`. De handtekening is een HMAC-SHA256
// over versie, gebruiker en categorie, met een sleutel die uit SESSION_SECRET is afgeleid
// (aparte domeinscheiding: de sleutel is niet dezelfde als die van crypto.ts of de sessie).
// Aanpassen van gebruiker of categorie maakt de handtekening ongeldig. De handeling
// (alleen deze categorie, of alle e-mail) staat bewust niet in het token: die kiest de
// gebruiker op de pagina en wordt per POST server-side gevalideerd.
// Mag nooit next/headers of de database importeren (eager-keten van server.ts).

const VERSION = "u1";
const USER_ID = /^[a-z0-9]{8,64}$/i;

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET ontbreekt of is te kort.");
  return createHash("sha256").update(`versado:unsubscribe:v1:${secret}`).digest();
}

function sign(userId: string, category: NotifyCategory): string {
  return createHmac("sha256", key()).update(`${VERSION}:${userId}:${category}`).digest("base64url");
}

export function createUnsubscribeToken(userId: string, category: NotifyCategory): string {
  return `${VERSION}.${userId}.${category}.${sign(userId, category)}`;
}

/** Geeft gebruiker en categorie terug als het token echt van ons is, anders null. Gooit nooit en logt niets. */
export function verifyUnsubscribeToken(raw: unknown): { userId: string; category: NotifyCategory } | null {
  if (typeof raw !== "string" || raw.length > 256) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, userId, category, signature] = parts;
  if (!USER_ID.test(userId) || !isNotifyCategory(category)) return null;
  let expected: Buffer;
  let given: Buffer;
  try {
    expected = Buffer.from(sign(userId, category));
    given = Buffer.from(signature);
  } catch {
    return null;
  }
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId, category };
}

/** De pagina die de gebruiker te zien krijgt; een GET hierop wijzigt nooit iets. */
export function unsubscribePageUrl(baseUrl: string, token: string, mode: "category" | "all" = "category"): string {
  return `${baseUrl}/uitschrijven/${encodeURIComponent(token)}${mode === "all" ? "?actie=alles" : ""}`;
}

/** Het POST-adres voor de List-Unsubscribe-header (RFC 8058, één klik vanuit de mailclient). */
export function unsubscribeOneClickUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/unsubscribe?t=${encodeURIComponent(token)}`;
}
