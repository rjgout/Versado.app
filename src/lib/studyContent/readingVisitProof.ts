import { createHmac, timingSafeEqual } from "node:crypto";

// Een kort geldig bewijs dat de server DEZE gepubliceerde revisie aan DEZE
// sessie heeft aangeboden. Geen algemeen toegangs- of publicatietoken.
export const READING_VISIT_TTL_SECONDS = 6 * 60 * 60;
type Visit = {
  purpose: "study-reader-visit-v1";
  userId: string;
  lessonEditionId: string;
  revisionId: string;
  sessionKey: string;
  issuedAt: number;
  expiresAt: number;
};

function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16)
    throw new Error("SESSION_SECRET ontbreekt of is te kort.");
  // Purpose separation: het sessie-JWT en de leesbewijzen gebruiken niet
  // rechtstreeks dezelfde HMAC-sleutel voor verschillende protocollen.
  return createHmac("sha256", secret)
    .update("versado:study-reader-visit:v1")
    .digest();
}
function signature(data: string): Buffer {
  return createHmac("sha256", signingKey()).update(data).digest();
}

/** Alleen aanroepen NA de normale published-only leesgate op de server. */
export function issueReadingVisitProof(
  userId: string,
  lessonEditionId: string,
  revisionId: string,
  sessionKey: string,
  now = Date.now(),
): string {
  if (!userId || !lessonEditionId || !revisionId || !sessionKey)
    throw new Error("READING_VISIT_INVALID");
  const issuedAt = Math.floor(now / 1000);
  const payload: Visit = {
    purpose: "study-reader-visit-v1",
    userId,
    lessonEditionId,
    revisionId,
    sessionKey,
    issuedAt,
    expiresAt: issuedAt + READING_VISIT_TTL_SECONDS,
  };
  const data = `rv1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${data}.${signature(data).toString("base64url")}`;
}

/** Historische revisie mag alleen een eigen, nog geldig leesbezoek voortzetten. */
export function validReadingVisitProof(
  proof: string | undefined,
  userId: string,
  lessonEditionId: string,
  revisionId: string,
  sessionKey: string | undefined,
  now = Date.now(),
): boolean {
  if (!proof || !sessionKey || proof.length > 1500) return false;
  const parts = proof.split(".");
  if (parts.length !== 3 || parts[0] !== "rv1") return false;
  try {
    const supplied = Buffer.from(parts[2], "base64url");
    const decoded = Buffer.from(parts[1], "base64url");
    if (supplied.toString("base64url") !== parts[2] || decoded.toString("base64url") !== parts[1])
      return false;
    const data = `${parts[0]}.${parts[1]}`;
    const expected = signature(data);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return false;
    const value = JSON.parse(decoded.toString("utf8")) as Visit;
    const at = Math.floor(now / 1000);
    return (
      value.purpose === "study-reader-visit-v1" &&
      value.userId === userId &&
      value.lessonEditionId === lessonEditionId &&
      value.revisionId === revisionId &&
      value.sessionKey === sessionKey &&
      Number.isSafeInteger(value.issuedAt) &&
      Number.isSafeInteger(value.expiresAt) &&
      value.issuedAt <= at + 60 &&
      value.expiresAt > at &&
      value.expiresAt - value.issuedAt === READING_VISIT_TTL_SECONDS
    );
  } catch {
    return false;
  }
}
