import { readManifest } from "@/lib/hymns/library/server";

/**
 * Lofzangen in de studielessen verwijzen naar de officiële kerkwebsite (`/study/manual/hymns/<slug>` of
 * `/media/music/songs/<slug>`). Het slug is de officiële, taalonafhankelijke identificatie van een lofzang en staat ook in het
 * Nederlandse zangboek (`manifest.hymns[].slug`); het lofzangnummer is dus de stabiele sleutel binnen de juiste uitgave, nooit de
 * zichtbare titel. Een slug dat niet (of dubbel) in het zangboek staat, levert geen koppeling op.
 */
let bySlug: Map<string, { number: number; title: string }> | null = null;
function index() {
  if (bySlug) return bySlug;
  const seen = new Map<string, { number: number; title: string }>();
  const ambiguous = new Set<string>();
  for (const hymn of readManifest().hymns) {
    if (!hymn.slug) continue;
    if (seen.has(hymn.slug)) ambiguous.add(hymn.slug);
    else seen.set(hymn.slug, { number: hymn.number, title: hymn.title });
  }
  for (const slug of ambiguous) seen.delete(slug);
  bySlug = seen;
  return seen;
}

export type HymnReference = { slug: string; number: number; title: string; href: string };

/** De lofzang bij een officiële kerk-URL naar een lofzang (alleen exact deze twee padvormen, https, geen extra parameters). */
export function hymnFromOfficialUrl(raw: string): HymnReference | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "www.churchofjesuschrist.org" || url.port || url.username || url.password) return null;
  const match = /^\/(?:study\/manual\/hymns|media\/music\/songs)\/([a-z0-9-]{1,120})$/.exec(url.pathname);
  if (!match) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "lang") || (url.searchParams.has("lang") && url.searchParams.get("lang") !== "nld")) return null;
  const hymn = index().get(match[1]);
  return hymn ? { slug: match[1], number: hymn.number, title: hymn.title, href: `/dev/lofzangen?lofzang=${hymn.number}` } : null;
}
