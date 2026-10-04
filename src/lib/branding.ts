import { prisma } from "@/lib/db";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BrandingView {
  logoDataUrl: string | null;
  faviconDataUrl: string | null;
  appName: string | null;
}

const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/;
// Ruime maar niet oneindige bovengrens — dit is een klein huisstijl-plaatje,
// geen gebruikersbestand (zie Feedback.screenshot voor dezelfde aanpak).
const MAX_DATA_URL_LENGTH = 2 * 1024 * 1024;
const HEADER_LOGO_FILENAME = "header-logo.png";

// De proxy mag tijdens onderhoud niet afhankelijk zijn van Next.js. Daarom
// krijgt hij de laatst opgeslagen headerbranding via een gedeeld volume.
// Zonder die optionele map blijft lokaal gedrag ongewijzigd.
function brandingAssetDir(): string | undefined {
  // Runtime lezen is belangrijk voor de Next.js-route: de map wordt in
  // Docker via Compose ingesteld en hoeft niet tijdens de build bekend te zijn.
  return process.env.BRANDING_ASSET_DIR;
}

export function isValidBrandingDataUrl(value: string): boolean {
  return DATA_URL_RE.test(value) && value.length <= MAX_DATA_URL_LENGTH;
}

export async function getBranding(): Promise<BrandingView> {
  const row = await prisma.brandingSettings.findUnique({ where: { id: "singleton" } });
  return {
    logoDataUrl: row?.logoDataUrl ?? null,
    faviconDataUrl: row?.faviconDataUrl ?? null,
    appName: row?.appName ?? null,
  };
}

export async function syncHeaderLogo(): Promise<void> {
  const assetDir = brandingAssetDir();
  if (!assetDir) return;

  const target = path.join(assetDir, HEADER_LOGO_FILENAME);
  const branding = await getBranding();
  const decoded = decodeBrandingDataUrl(branding.logoDataUrl);

  if (!decoded) {
    await rm(target, { force: true });
    return;
  }

  // De Huisstijl-upload zet het headerlogo om naar PNG. Alleen die vorm wordt
  // hier naar de vaste nginx-URL geschreven; zo krijgt de proxy nooit een
  // verkeerde MIME-typecombinatie bij een handmatig gemuteerde databaserecord.
  if (decoded.contentType !== "image/png") {
    await rm(target, { force: true });
    return;
  }

  await mkdir(assetDir, { recursive: true });
  const temporary = path.join(assetDir, `.${HEADER_LOGO_FILENAME}.${process.pid}.tmp`);
  await writeFile(temporary, decoded.buffer);
  await rename(temporary, target);
}

export async function updateBranding(patch: Partial<BrandingView>): Promise<void> {
  await prisma.brandingSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...patch },
    update: patch,
  });

  try {
    await syncHeaderLogo();
  } catch (error) {
    // Een branding-update mag niet mislukken omdat de optionele proxy-volume
    // tijdelijk niet schrijfbaar is. De volgende app-start synchroniseert
    // het bestand opnieuw.
    console.warn("Headerlogo kon niet naar de onderhoudsproxy worden gesynchroniseerd.", error);
  }
}

/** Haalt content-type + ruwe bytes uit een branding-data-URL (favicon/logo). Gedeeld door de serve-routes hieronder in /api/branding/*. */
export function decodeBrandingDataUrl(dataUrl: string | null): { contentType: string; buffer: Uint8Array<ArrayBuffer> } | null {
  const match = dataUrl ? /^data:([^;]+);base64,(.+)$/.exec(dataUrl) : null;
  if (!match) return null;
  const [, contentType, base64] = match;
  // Een Buffer kan op een gedeeld geheugenblok staan; een Response-body moet
  // een eigen ArrayBuffer hebben, dus een losse kopie (het icoon is klein).
  return { contentType, buffer: new Uint8Array(Buffer.from(base64, "base64")) };
}
