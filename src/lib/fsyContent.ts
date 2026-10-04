import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export const FSY_COLLECTION_ID = "content_fsy";
export const FSY_COURSE_SLUG = "voor-de-kracht-van-de-jeugd";
const FSY_BASE_URL = "https://www.churchofjesuschrist.org";
const FETCH_TIMEOUT_MS = 15_000;
// Een paar pagina's tegelijk ophalen: één voor één maakte de controle (en
// daarmee de hele seed) traag, maar de bron hoeft niet bestookt te worden.
const FETCH_CONCURRENCY = 4;

type Fetched<T> = { value: T } | { error: unknown };

/** `work` over alle items, met hooguit `limit` tegelijk; resultaten op volgorde. */
async function mapLimited<I, T>(items: I[], limit: number, work: (item: I) => Promise<T>): Promise<Fetched<T>[]> {
  const results: Fetched<T>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface FsyContentBlock {
  type: "heading" | "paragraph" | "list-item" | "quote" | "image";
  text?: string;
  url?: string;
  alt?: string;
}

export interface FsyImage {
  url: string;
  alt: string;
}

interface ScrapedPage {
  title: string;
  blocks: FsyContentBlock[];
  images: FsyImage[];
}


const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&ndash;": "–",
    "&mdash;": "—",
    "&lsquo;": "‘",
    "&rsquo;": "’",
    "&ldquo;": "“",
    "&rdquo;": "”",
    "&hellip;": "…",
  };

  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, (entity) => named[entity.toLowerCase()] ?? entity);
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isolateContent(html: string): string {
  const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0];
  if (article) return article;

  const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)?.[0];
  if (main) return main;

  return html;
}

function parseImages(html: string, pageUrl: string): FsyImage[] {
  const images: FsyImage[] = [];
  const seen = new Set<string>();

  const imageTag = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imageTag)) {
    const tag = match[0];
    const src =
      tag.match(/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1]?.split(",")[0]?.trim().split(/\s+/)[0];
    if (!src || src.startsWith("data:")) continue;

    let url: string;
    try {
      url = new URL(src, pageUrl).toString();
    } catch {
      continue;
    }

    const alt = decodeHtml(tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "").trim();
    if (seen.has(url)) continue;
    seen.add(url);
    images.push({ url, alt });
  }

  return images;
}

function parseBlocks(html: string, pageUrl: string): { blocks: FsyContentBlock[]; title: string } {
  const contentHtml = isolateContent(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");

  const blocks: FsyContentBlock[] = [];
  let title = "";

  const tokenPattern = /<(h[1-4]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*>/gi;
  for (const match of contentHtml.matchAll(tokenPattern)) {
    const tag = match[1]?.toLowerCase();
    const inner = match[2] ?? "";

    if (!tag) {
      const imageTag = match[0];
      const src =
        imageTag.match(/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1] ??
        imageTag.match(/\bsrcset=["']([^"']+)["']/i)?.[1]?.split(",")[0]?.trim().split(/\s+/)[0];
      if (!src || src.startsWith("data:")) continue;

      try {
        const url = new URL(src, pageUrl).toString();
        const alt = decodeHtml(imageTag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "").trim();
        if (!blocks.some((block) => block.type === "image" && block.url === url)) {
          blocks.push({ type: "image", url, alt });
        }
      } catch {
        // Een kapotte afbeeldings-URL mag de rest van de les niet blokkeren.
      }
      continue;
    }

    const text = cleanText(inner);
    if (!text) continue;

    if (tag === "h1") {
      if (!title) title = text;
      blocks.push({ type: "heading", text });
    } else if (tag === "h2" || tag === "h3" || tag === "h4") {
      blocks.push({ type: "heading", text });
    } else if (tag === "li") {
      blocks.push({ type: "list-item", text });
    } else if (tag === "blockquote") {
      blocks.push({ type: "quote", text });
    } else {
      blocks.push({ type: "paragraph", text });
    }
  }

  return { blocks, title };
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Jehova.app/1.0 (+https://jehova.app; FSY-contentcontrole)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function monthUrl(year: number, month: number): string {
  return `${FSY_BASE_URL}/study/ftsoy/${year}/${String(month).padStart(2, "0")}/fsy-lessons/00-intro?lang=nld`;
}

function extractLessonLinks(html: string, year: number, month: number): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href=["']([^"']*\/fsy-lessons\/[^"'#?]+)(?:\?[^"']*)?["'][^>]*>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = decodeHtml(match[1]);
    try {
      const url = new URL(href, FSY_BASE_URL);
      const expectedPath = `/study/ftsoy/${year}/${String(month).padStart(2, "0")}/fsy-lessons/`;
      if (!url.pathname.startsWith(expectedPath)) continue;
      url.search = "?lang=nld";
      const normalized = url.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        links.push(normalized);
      }
    } catch {
      // Een enkele ongeldige link negeren; andere lessen blijven bruikbaar.
    }
  }

  return links;
}

function slugFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  return pathname.split("/").filter(Boolean).at(-1) ?? "les";
}

function categoryFromSlug(slug: string): string {
  if (slug === "00-intro") return "INTRO";
  if (slug === "01-fast-sunday") return "FAST_SUNDAY";
  if (slug === "02-second-sunday") return "SECOND_SUNDAY";
  if (slug === "03-third-sunday") return "THIRD_SUNDAY";
  if (slug === "04a-fourth-sunday") return "LAST_SUNDAY_YOUNG_WOMEN";
  if (slug === "04b-fourth-sunday") return "LAST_SUNDAY_AARONIC_PRIESTHOOD";
  if (slug.startsWith("youth-activity")) return "ACTIVITY";
  return "OTHER";
}

function contentHash(page: ScrapedPage): string {
  return createHash("sha256")
    .update(JSON.stringify({ title: page.title, blocks: page.blocks, images: page.images }))
    .digest("hex");
}

async function scrapeLesson(url: string): Promise<ScrapedPage> {
  const html = await fetchHtml(url);
  const { blocks, title } = parseBlocks(html, url);
  const images = parseImages(isolateContent(html), url);

  if (!title || blocks.length === 0) {
    throw new Error("Geen bruikbare lesinhoud gevonden.");
  }

  return { title, blocks, images };
}

async function publishLesson(
  client: PrismaClient,
  lessonId: string,
  log: (msg: string) => void = console.log
): Promise<void> {
  const lesson = await client.fsyLesson.findUnique({ where: { id: lessonId } });
  if (!lesson) throw new Error("FSY-les niet gevonden.");

  await client.fsyLesson.update({
    where: { id: lessonId },
    data: {
      status: "PUBLISHED",
      publishedTitle: lesson.title,
      publishedContent: lesson.content,
      publishedImages: lesson.images,
      publishedAt: new Date(),
    },
  });
  log(`FSY gepubliceerd: ${lesson.title}`);
}

export async function publishFsyLesson(client: PrismaClient, lessonId: string): Promise<void> {
  await publishLesson(client, lessonId);
}

export async function getFsySettings(client: PrismaClient): Promise<{
  autoPublish: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
}> {
  const settings = await client.fsySettings.findUnique({ where: { id: "singleton" } });
  return {
    autoPublish: settings?.autoPublish ?? false,
    lastCheckedAt: settings?.lastCheckedAt ?? null,
    lastError: settings?.lastError ?? null,
  };
}

export async function updateFsyAutoPublish(client: PrismaClient, autoPublish: boolean): Promise<void> {
  await client.fsySettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", autoPublish },
    update: { autoPublish, lastError: null },
  });
}

// De scheduler tikt elke minuut en lastCheckedAt wordt pas aan het eind van
// een run gezet. Een run over twaalf maanden duurt langer dan een minuut, dus
// zonder deze vlag startten er tientallen overlappende runs. Een tweede
// aanroep wacht nu op de run die al loopt.
let syncInFlight: Promise<void> | null = null;

export function syncFsyContent(
  client: PrismaClient,
  log: (msg: string) => void = console.log
): Promise<void> {
  if (!syncInFlight) {
    syncInFlight = runFsySync(client, log).finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

async function runFsySync(
  client: PrismaClient,
  log: (msg: string) => void
): Promise<void> {
  const settings = await client.fsySettings.findUnique({ where: { id: "singleton" } });
  const autoPublish = settings?.autoPublish ?? false;
  const collection = await client.contentCollection.findUnique({ where: { id: FSY_COLLECTION_ID } });
  if (!collection) throw new Error("FSY-contentcollectie ontbreekt.");

  const year = new Date().getUTCFullYear();
  let discovered = 0;
  let created = 0;
  let changed = 0;
  let published = 0;

  try {
    const intros = await mapLimited(MONTHS, FETCH_CONCURRENCY, (month) => fetchHtml(monthUrl(year, month)));
    for (const [monthIndex, month] of MONTHS.entries()) {
      const introUrl = monthUrl(year, month);
      let introHtml: string;
      try {
        const intro = intros[monthIndex];
        if ("error" in intro) throw intro.error;
        introHtml = intro.value;
      } catch (e) {
        // Niet-gepubliceerde toekomstige maanden geven normaal 404. Alleen
        // echte netwerk-/serverfouten worden in de log zichtbaar gemaakt.
        const message = e instanceof Error ? e.message : String(e);
        if (message === "HTTP 404") continue;
        log(`FSY ${year}-${String(month).padStart(2, "0")}: controle mislukt (${message}).`);
        continue;
      }

      const introLinks = extractLessonLinks(introHtml, year, month);
      const urls = [introUrl, ...introLinks.filter((url) => url !== introUrl)];
      discovered += urls.length;
      // Ophalen tegelijk, verwerken daarna op volgorde (de volgorde is de lesvolgorde).
      const pages = await mapLimited(urls, FETCH_CONCURRENCY, scrapeLesson);

      for (let order = 0; order < urls.length; order++) {
        const url = urls[order];
        try {
          const fetched = pages[order];
          if ("error" in fetched) throw fetched.error;
          const page = fetched.value;
          const hash = contentHash(page);
          const slug = slugFromUrl(url);
          const category = categoryFromSlug(slug);
          const existing = await client.fsyLesson.findUnique({
            where: { contentCollectionId_sourceUrl: { contentCollectionId: collection.id, sourceUrl: url } },
          });

          const baseData = {
            year,
            month,
            category,
            slug,
            title: page.title,
            content: JSON.stringify(page.blocks),
            images: JSON.stringify(page.images),
            sourceUrl: url,
            sourceHash: hash,
            lastScrapedAt: new Date(),
            order,
          };

          if (!existing) {
            const createdLesson = await client.fsyLesson.create({
              data: {
                contentCollectionId: collection.id,
                ...baseData,
                ...(autoPublish
                  ? {
                      status: "PUBLISHED",
                      publishedTitle: page.title,
                      publishedContent: JSON.stringify(page.blocks),
                      publishedImages: JSON.stringify(page.images),
                      publishedAt: new Date(),
                    }
                  : {}),
              },
            });
            created++;
            if (autoPublish) published++;
            else log(`Nieuwe FSY-conceptles: ${createdLesson.title}`);
            continue;
          }

          if (existing.sourceHash === hash) {
            await client.fsyLesson.update({
              where: { id: existing.id },
              data: { lastScrapedAt: new Date(), order },
            });
            continue;
          }

          changed++;
          const updateData: Record<string, unknown> = { ...baseData };
          if (autoPublish) {
            Object.assign(updateData, {
              status: "PUBLISHED",
              publishedTitle: page.title,
              publishedContent: JSON.stringify(page.blocks),
              publishedImages: JSON.stringify(page.images),
              publishedAt: new Date(),
            });
            published++;
          } else {
            updateData.status = "DRAFT";
            log(`Gewijzigde FSY-les als concept opgeslagen: ${page.title}`);
          }

          await client.fsyLesson.update({ where: { id: existing.id }, data: updateData });
        } catch (e) {
          log(`FSY-les ${url} overgeslagen: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    await client.fsySettings.update({
      where: { id: "singleton" },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
    log(`FSY-controle klaar: ${discovered} pagina's gevonden, ${created} nieuw, ${changed} gewijzigd${autoPublish ? `, ${published} gepubliceerd` : ", concepten wachten op controle"}.`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await client.fsySettings.update({ where: { id: "singleton" }, data: { lastCheckedAt: new Date(), lastError: message } });
    throw e;
  }
}

export async function runFsyWeeklyCheckIfDue(
  client: PrismaClient,
  now = new Date(),
  log: (msg: string) => void = console.log
): Promise<void> {
  const amsterdam = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const parts = Object.fromEntries(amsterdam.map((part) => [part.type, part.value]));
  if (parts.weekday !== "Mon" || Number(parts.hour) !== 3) return;
  if (syncInFlight) return;

  const lastChecked = await client.fsySettings.findUnique({
    where: { id: "singleton" },
    select: { lastCheckedAt: true },
  });
  if (lastChecked?.lastCheckedAt && now.getTime() - lastChecked.lastCheckedAt.getTime() < 6 * 24 * 60 * 60 * 1000) return;

  await syncFsyContent(client, log);
}
