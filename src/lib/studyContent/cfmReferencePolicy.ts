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

/**
 * De hosts waarvan de officiële CFM-bron zelf MP4-bestanden aanbiedt: de huidige videohost en het oudere CDN van de Kerk
 * (`ldscdn.org`), dat in de officiële lespagina's nog voorkomt. Exacte hostnamen; geen wildcard en geen subdomeinraden.
 */
export const CFM_VIDEO_HOSTS: readonly string[] = ["assets.churchofjesuschrist.org", "media2.ldscdn.org"];
/** Alleen de officiële bronhosts van CFM (lessen, afbeeldingen, video's); geen wildcard en geen subdomeinraden. */
export const CFM_OFFICIAL_HOSTS: readonly string[] = ["www.churchofjesuschrist.org", ...CFM_VIDEO_HOSTS];

/** Markeringen die de adapter zelf zet wanneer een verwijzing niet bewezen kan worden (nooit een gokken van een doel). */
const KNOWN_MARKERS = ["unverified-numbering:", "unverified-range:"];
const INTERNAL_KEY = /^(?:otb|otb-set):/;

export interface CfmReferenceTargetShape {
  sourceKey: string;
  externalUrl?: string | null;
}

/**
 * Een https-URL met een gewone openbare hostnaam, zonder inloggegevens, poort, IP-adres of vreemde tekens. Zo'n URL wordt als
 * *tekst* getoond (nooit als link, tenzij de centrale resolver hem bewijst), dus een externe host zoals familysearch.org is
 * veilig; een niet-https-, `javascript:`-, `data:`-, lokale of malafide URL is dat niet.
 */
function safeUrl(raw: string | null | undefined): boolean | null {
  if (!raw) return null;
  if (raw.length > 2048 || /[\u0000-\u0020\\]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname;
  return (
    url.protocol === "https:" && !url.username && !url.password && !url.port &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host) && host.toLowerCase() !== "localhost"
  );
}
const safeOfficialUrl = safeUrl;

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
