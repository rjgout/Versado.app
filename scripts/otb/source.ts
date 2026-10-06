import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SOURCE_LOCK_PATH = "scripts/otb/source-lock.json";

interface SourceLock {
  repository: string;
  upstreamCommit: string;
}

export function pinnedArchiveUrl(lock: SourceLock): string {
  return `https://github.com/${lock.repository}/archive/${lock.upstreamCommit}.tar.gz`;
}

async function readSourceLock(): Promise<SourceLock> {
  return JSON.parse(await readFile(join(process.cwd(), SOURCE_LOCK_PATH), "utf8")) as SourceLock;
}

/** Haalt één vaste OTB-snapshot op en bewaart die per SHA in een tijdelijke cache. */
export async function preparePinnedOtbSource(log: (message: string) => void = console.log): Promise<string> {
  const lock = await readSourceLock();
  const cacheRoot = process.env.OTB_CACHE_DIR || join(tmpdir(), "versado-otb");
  const target = join(cacheRoot, lock.upstreamCommit);
  const marker = join(target, ".otb-upstream-commit");

  try {
    if ((await readFile(marker, "utf8")).trim() === lock.upstreamCommit) {
      await access(join(target, "lang", "nl-NL"));
      log("Open Translation Bible uit cache gebruiken...");
      return target;
    }
  } catch {
    // Een ontbrekende of onvolledige cache wordt hieronder opnieuw opgebouwd.
  }

  await mkdir(cacheRoot, { recursive: true });
  await rm(target, { recursive: true, force: true });
  const temporary = await mkdtemp(join(cacheRoot, ".download-"));
  const archivePath = join(temporary, "otb.tar.gz");
  try {
    const url = pinnedArchiveUrl(lock);
    log("Open Translation Bible downloaden...");
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "Versado-OTB-import/1.0" } });
    if (!response.ok) throw new Error(`OTB-download gaf HTTP ${response.status}.`);
    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    log("Gepinde bron uitpakken...");
    await execFileAsync("tar", ["-xzf", archivePath, "-C", temporary]);
    const entries = (await readdir(temporary, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== ".");
    const extracted = entries.find((entry) => entry.name.startsWith("open-bible-"));
    if (!extracted) throw new Error("OTB-archief bevat geen verwachte open-bible-map.");
    const extractedRoot = join(temporary, extracted.name);
    await writeFile(join(extractedRoot, ".otb-upstream-commit"), `${lock.upstreamCommit}\n`);
    await rename(extractedRoot, target);
    return target;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
