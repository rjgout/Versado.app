// Alleen publieke, gepinde bronbestanden voor geïsoleerde tests. Geen databaseverbinding of import.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
const root = process.env.OTB_PUBLICATION_TEST_SOURCE;
if (!root || !isAbsolute(root) || !root.startsWith("/tmp/")) throw Error("OTB_PUBLICATION_TEST_SOURCE vereist een eigen absolute /tmp-map");
const lock = JSON.parse(readFileSync("scripts/otb/source-lock.json", "utf8"));
const git = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (!existsSync(root)) {
  git(["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${lock.repository}.git`, root]);
  git(["-C", root, "sparse-checkout", "set", "--no-cone", "/LICENCE.md", ...lock.locales.map(locale => `/lang/${locale}/*/json/`)]);
  git(["-C", root, "checkout", "--detach", lock.upstreamCommit]);
}
if (git(["-C", root, "rev-parse", "HEAD"]).trim() !== lock.upstreamCommit || git(["-C", root, "status", "--porcelain"]).trim()) throw Error("Testbron moet een schone checkout van de gepinde bron zijn");
console.log("Gepinde OTB-testbron aanwezig; geen database gewijzigd.");
