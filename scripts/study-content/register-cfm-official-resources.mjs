// Offline registratie van exact gecontroleerde bron-URL's; nooit een host-vrijbrief.
import fs from "node:fs/promises";
const root = "data/study-content/cfm-2026-nl/";
const checks = JSON.parse(
  await fs.readFile(root + "reference-source-checks.json", "utf8"),
);
const baseline = JSON.parse(
  await fs.readFile(root + "reference-review-baseline.json", "utf8"),
);
const urls = new Set(
  baseline.occurrences.map((r) => r.originalTarget.externalUrl),
);
const records = checks.resources
  .filter((r) => r.verified)
  .map((r) => {
    const u = new URL(r.url);
    if (
      !urls.has(r.url) ||
      u.protocol !== "https:" ||
      ![
        "www.churchofjesuschrist.org",
        "assets.churchofjesuschrist.org",
      ].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port
    )
      throw Error("UNPROVEN_RESOURCE");
    if (
      r.method === "official-nld-content-api" &&
      (r.language !== "nl" ||
        !r.verifiedApi ||
        !/^[a-f0-9]{64}$/.test(r.sourceHash))
    )
      throw Error("UNPROVEN_LANGUAGE");
    if (
      r.method === "official-binary-prefix-only" &&
      (!r.binaryChecked || !/^[a-f0-9]{64}$/.test(r.prefixHash))
    )
      throw Error("UNPROVEN_BINARY");
    return {
      path: r.url,
      url: r.url,
      method: r.method,
      evidenceHash: r.sourceHash ?? r.prefixHash,
      checkedAt: checks.checkedAt,
      ...(r.verifiedApi
        ? { verifiedApi: r.verifiedApi, title: r.title, language: r.language }
        : { mimeType: r.mimeType, mediaLanguage: r.mediaLanguage }),
    };
  });
await fs.writeFile(
  "src/lib/references/official-resources-cfm.json",
  JSON.stringify(records, null, 2) + "\n",
);
console.log(JSON.stringify({ registeredExactUrls: records.length }));
