// Alleen gepinde publieke testbronbestanden; geen database of productie-import.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = process.env.CFM_TEST_ASSETS;
if (!root || !path.isAbsolute(root) || !root.startsWith("/tmp/"))
  throw Error("CFM_TEST_ASSETS moet een eigen map onder /tmp zijn.");
const media = JSON.parse(
  await fs.readFile("data/study-content/cfm-2026-nl/media-lock.json", "utf8"),
);
const index = JSON.parse(
  await fs.readFile("data/study-content/cfm-2026-nl/otb-index.json", "utf8"),
);
const entries = [
  ...media.map((a) => ({
    file: "media/" + a.file,
    url: a.url,
    sha: a.checksum,
    git: false,
  })),
  ...index.chapters.map((c) => ({
    file: "otb/" + c.sourceFile,
    url: `https://raw.githubusercontent.com/OpenTranslationBible/open-bible/${index.upstreamCommit}/lang/nl-NL/${encodeURI(c.sourceFile)}`,
    sha: c.sourceBlob,
    git: true,
  })),
];
function valid(bytes, e) {
  return (
    createHash(e.git ? "sha1" : "sha256")
      .update(
        e.git
          ? Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])
          : bytes,
      )
      .digest("hex") === e.sha
  );
}
async function pinnedResponse(source) {
  let url = new URL(source);
  const host = url.hostname;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || url.port)
      throw Error("CFM_TEST_REDIRECT_HOST");
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 3) throw Error("CFM_TEST_REDIRECT_LIMIT");
    url = new URL(location, url);
  }
  throw Error("CFM_TEST_REDIRECT_LIMIT");
}
await fs.mkdir(root, { recursive: true });
let next = 0;
async function worker() {
  while (next < entries.length) {
    const e = entries[next++],
      p = path.join(root, e.file);
    try {
      if (valid(await fs.readFile(p), e)) continue;
    } catch {}
    const u = new URL(e.url);
    if (
      u.protocol !== "https:" ||
      !["www.churchofjesuschrist.org", "raw.githubusercontent.com"].includes(
        u.hostname,
      )
    )
      throw Error("CFM_TEST_HOST");
    // De officiële afbeeldingsdienst kan naar een canoniek pad op dezelfde
    // host verwijzen. Controleer elke stap; bronhash en bytegrens blijven gelden.
    const r = await pinnedResponse(u);
    if (!r.ok) throw Error(`CFM_ASSET_HTTP:${r.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > 10485760) throw Error("CFM_ASSET_SIZE");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (!valid(bytes, e)) throw Error("CFM_ASSET_HASH");
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, bytes, { mode: 0o600 });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(
  JSON.stringify({
    pinnedMedia: media.length,
    pinnedOtbChapters: index.chapters.length,
    productionTouched: false,
  }),
);
