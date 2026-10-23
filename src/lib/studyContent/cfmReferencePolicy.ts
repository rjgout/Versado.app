/**
 * Beleid voor verwijzingen in officiële CFM-lessen die niet naar een interne of bewezen externe bron te leggen zijn.
 *
 * De projecteigenaar accepteert dat CFM-inhoud bekende, inhoudelijk onoplosbare verwijzingen bevat. Zo'n verwijzing blokkeert
 * de publicatie niet meer, maar wordt als veilige, niet-klikbare tekst getoond; er wordt nooit een URL verzonnen of geraden.
 * Alleen die ene categorie wordt gedegradeerd. De rest blijft een blokkade (de les wordt niet gepubliceerd).
 *
 * Dit is een zuivere classificatie van het *doel*: of de verwijzing werkelijk niet oplost, bepaalt de centrale resolver.
 */
export type CfmUnresolvedClass =
  /** Een goed gevormd, veilig officieel doel dat (nog) niet op te lossen is: wordt gewone tekst. */
  | "KNOWN_UNRESOLVABLE"
  /** Een URL die niet veilig of niet officieel is (geen https, inloggegevens, poort, vreemde host): blokkeert. */
  | "UNSAFE_URL"
  /** Een doel waarvan de structuur niet te herkennen is: blokkeert. */
  | "UNKNOWN";

/** Alleen de officiële bronhosts van CFM (lessen, afbeeldingen, video's); geen wildcard en geen subdomeinraden. */
export const CFM_OFFICIAL_HOSTS: readonly string[] = ["www.churchofjesuschrist.org", "assets.churchofjesuschrist.org"];

/** Markeringen die de adapter zelf zet wanneer een verwijzing niet bewezen kan worden (nooit een gokken van een doel). */
const KNOWN_MARKERS = ["unverified-numbering:", "unverified-range:"];
const INTERNAL_KEY = /^(?:otb|otb-set):/;

export interface CfmReferenceTargetShape {
  sourceKey: string;
  externalUrl?: string | null;
}

function safeOfficialUrl(raw: string | null | undefined): boolean | null {
  if (!raw) return null;
  if (raw.length > 2048 || /[\u0000- \\]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && !url.port && CFM_OFFICIAL_HOSTS.includes(url.hostname);
}

/** Classificeert een verwijzing die de centrale resolver niet kon oplossen. */
export function classifyUnresolvedCfmReference(target: CfmReferenceTargetShape): CfmUnresolvedClass {
  const external = safeOfficialUrl(target.externalUrl);
  if (external === false) return "UNSAFE_URL";
  // Een sourceKey die zelf een URL is (de terugval van de adapter) volgt dezelfde veiligheidsregel.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target.sourceKey) && !INTERNAL_KEY.test(target.sourceKey) && !KNOWN_MARKERS.some((m) => target.sourceKey.startsWith(m))) {
    const direct = safeOfficialUrl(target.sourceKey);
    if (direct === false) return "UNSAFE_URL";
    return direct ? "KNOWN_UNRESOLVABLE" : "UNKNOWN";
  }
  if (INTERNAL_KEY.test(target.sourceKey) || KNOWN_MARKERS.some((m) => target.sourceKey.startsWith(m))) return external === true ? "KNOWN_UNRESOLVABLE" : "UNKNOWN";
  return "UNKNOWN";
}
export const isKnownUnresolvableCfmReference = (target: CfmReferenceTargetShape) => classifyUnresolvedCfmReference(target) === "KNOWN_UNRESOLVABLE";
