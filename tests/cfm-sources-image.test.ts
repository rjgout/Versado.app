import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CFM_SOURCES } from "@/lib/studyContent/cfmSources";

// Productie draait de runtime-image, niet de repository. Zonder de gepinde bronmap van een geregistreerde jaargang in die
// image faalt cfmApprovedSnapshot() (INCOMPLETE), verdwijnt het CFM-vinkje in Content opnieuw laden en draait de gewone
// seed zonder CFM-import of melding (zo bleef CFM 2027 in productie onzichtbaar).
const dockerfile = fs.readFileSync("Dockerfile", "utf8");
const copies = dockerfile
  .split("\n")
  .map((line) => /^COPY\s+(?!--)(\S+)\s+\.?\/?(\S+)\s*$/.exec(line.trim()))
  .filter((m): m is RegExpExecArray => !!m);

test("de runtime-image bevat de bronmap van elke geregistreerde CFM-jaargang", () => {
  for (const source of CFM_SOURCES) {
    const covered = copies.some(([, from, to]) => {
      const dest = to.replace(/^\.\//, "").replace(/\/$/, "");
      const origin = from.replace(/^\.\//, "").replace(/\/$/, "");
      return origin === dest && (source.dataDir === origin || source.dataDir.startsWith(`${origin}/`));
    });
    assert.ok(covered, `Dockerfile kopieert ${source.dataDir} (jaargang ${source.volume.year}) niet naar de runtime-image`);
  }
});

test("elk goedkeuringsbestand van elke jaargang bestaat in de repository", () => {
  for (const source of CFM_SOURCES)
    for (const name of source.approvalFiles)
      assert.ok(fs.existsSync(`${source.dataDir}/${name}`), `${source.dataDir}/${name} ontbreekt`);
});
