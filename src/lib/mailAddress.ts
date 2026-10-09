/**
 * Maskeert een e-mailadres voor publieke pagina's (bv. de uitschrijfpagina, die zonder
 * login werkt): genoeg om te herkennen om welk account het gaat, zo weinig mogelijk om
 * iets te lekken. `raphael@example.com` wordt `r***@e***.com`.
 * - een deel van minder dan 3 tekens wordt helemaal `***` (anders staat het bijna volledig open);
 * - van het domein blijft alleen het laatste deel (`.com`, `.nl`) zichtbaar; subdomeinen
 *   worden elk gemaskeerd (`mail.uni.example.co.uk` → `m***.u***.e***.co.uk`: alleen de laatste label blijft);
 * - alles wat geen geldig adres lijkt wordt `***`, nooit de oorspronkelijke tekst.
 */
function maskPart(part: string): string {
  const chars = Array.from(part);
  return chars.length >= 3 ? `${chars[0]}***` : "***";
}

export function maskEmail(email: string): string {
  const value = (email ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return "***";
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split(".").filter(Boolean);
  if (labels.length === 0) return "***";
  const tld = labels.length > 1 ? labels[labels.length - 1] : null;
  const masked = (tld ? labels.slice(0, -1) : labels).map(maskPart).join(".");
  return `${maskPart(local)}@${masked}${tld ? `.${tld}` : ""}`;
}
