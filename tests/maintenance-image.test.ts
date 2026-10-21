// Statische borging van de onderhoudsimage (Dockerfile target `maintenance`, deploy/maintenance-stack.yml, CI-job). De echte
// imagecontrole draait in de workflow (job `maintenance-image`, scripts/ci/check-maintenance-image.sh); deze test voorkomt dat de
// opzet stilletjes verandert: de app-image blijft de standaard en zonder onderhoudsscripts, de onderhoudsimage start niets zelf.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
/** Zonder commentaarregels: uitleg in commentaar telt niet als gedrag van de image of stack. */
const code = (text: string) => text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");

/** Splitst de Dockerfile in stages (naam → regels), in volgorde. */
function stages(dockerfile: string): Array<{ name: string; from: string; body: string }> {
  const parts = code(dockerfile).split(/^(?=FROM )/m).filter((part) => part.startsWith("FROM "));
  return parts.map((body) => {
    const match = body.match(/^FROM (\S+)(?: AS (\S+))?/)!;
    return { name: match[2] ?? "", from: match[1], body };
  });
}

test("de laatste stage blijft `runner`: een build zonder --target bouwt nog steeds de app-image", () => {
  const all = stages(read("Dockerfile"));
  assert.equal(all.at(-1)!.name, "runner");
  assert.deepEqual(all.map((stage) => stage.name), ["base", "deps", "builder", "runtime-base", "maintenance", "runner"]);
});

test("de onderhoudsimage deelt de runtime met de app en voegt alleen de cursusscripts toe", () => {
  const all = Object.fromEntries(stages(read("Dockerfile")).map((stage) => [stage.name, stage]));
  assert.equal(all.maintenance.from, "runtime-base");
  assert.equal(all.runner.from, "runtime-base");
  assert.match(all.maintenance.body, /COPY scripts\/courses \.\/scripts\/courses/);
  assert.doesNotMatch(all.runner.body, /scripts\/courses/, "de app-image bevat de onderhoudsscripts niet");
  assert.doesNotMatch(all["runtime-base"].body, /scripts\/courses|^CMD|^HEALTHCHECK|^EXPOSE/m, "de gedeelde basis bevat geen onderhoudsscripts of startgedrag");
  const copies = [...all.maintenance.body.matchAll(/^COPY (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(copies, ["scripts/courses ./scripts/courses"], "geen andere bestanden dan de cursusscripts erbovenop");
});

test("de onderhoudsimage start niets zelf: geen migraties, geen server, geen healthcheck", () => {
  const maintenance = stages(read("Dockerfile")).find((stage) => stage.name === "maintenance")!;
  const cmd = maintenance.body.match(/^CMD .*$/m)![0];
  assert.doesNotMatch(cmd, /migrate|npm start|server|tsx/i);
  assert.match(maintenance.body, /^HEALTHCHECK NONE$/m);
  const runner = stages(read("Dockerfile")).find((stage) => stage.name === "runner")!;
  assert.match(runner.body, /prisma migrate deploy/, "de app-image behoudt zijn eigen startgedrag");
});

test("de Portainer-stack heeft geen poorten, volumes, Docker-socket of herstartbeleid en vereist expliciete variabelen", () => {
  const stack = code(read("deploy/maintenance-stack.yml"));
  assert.match(stack, /image: ghcr\.io\/rjgout\/jehova-maintenance:latest/);
  assert.match(stack, /restart: "no"/);
  for (const forbidden of [/^\s*ports:/m, /^\s*volumes:/m, /docker\.sock/, /privileged/, /network_mode/, /^\s*pid:/m, /^\s*devices:/m]) assert.doesNotMatch(stack, forbidden, String(forbidden));
  assert.match(stack, /cap_drop:\n\s+- ALL/);
  assert.match(stack, /no-new-privileges:true/);
  assert.match(stack, /DATABASE_URL: \$\{MAINTENANCE_DATABASE_URL:\?/, "geen standaardverbinding");
  assert.match(stack, /external: true/);
  assert.doesNotMatch(stack, /postgresql:\/\/[^$\s]/, "geen vaste verbindings-URL of wachtwoord in het bestand");
});

test("de workflow publiceert de onderhoudsimage en controleert hem in CI", () => {
  const workflow = code(read(".github/workflows/docker-publish.yml"));
  assert.match(workflow, /- name: jehova-maintenance\n\s+context: \.\n\s+dockerfile: \.\/Dockerfile\n\s+target: maintenance/);
  assert.match(workflow, /target: \$\{\{ matrix\.target \}\}/);
  assert.doesNotMatch(workflow, /- name: jehova-app\n(?:\s+(?:context|dockerfile):.*\n)+\s+target:/, "de app-image wordt zonder target gebouwd");
  const job = workflow.slice(workflow.indexOf("  maintenance-image:"));
  assert.match(job, /postgres:16-alpine/, "wegwerp-PostgreSQL in CI");
  assert.match(job, /target: maintenance\n\s+load: true\n\s+push: false/, "de controlejob laadt lokaal en publiceert nooit");
  assert.match(job, /scripts\/ci\/check-maintenance-image\.sh jehova-maintenance:ci/);
});

test("het CI-controlescript dekt aanwezigheid, niet-startgedrag, foutmelding, --apply-weigering en een dry-run zonder wijzigingen", () => {
  const script = read("scripts/ci/check-maintenance-image.sh");
  for (const needle of [
    "scripts/courses/audit-duplicates.ts",
    "scripts/courses/repair-duplicates.ts",
    "start niets zelf",
    "ERR_MODULE_NOT_FOUND",
    "DATABASE_URL is niet gezet",
    "--apply --backup-gemaakt",
    "Weigering",
    "prisma migrate deploy",
    "Dry-run: er is niets gewijzigd",
    "heeft databasegegevens gewijzigd",
  ]) assert.ok(script.includes(needle), needle);
  assert.match(script, /alleen een lokale wegwerpdatabase/, "weigert elke andere database dan een lokale wegwerpdatabase");
  assert.doesNotMatch(script, /--apply --backup-gemaakt --verwacht-database/, "voert nooit een echt herstel uit");
});

test("de documentatie beschrijft de Portainer-route en verwijst naar de bevestigingen", () => {
  const doc = read("docs/DEPLOY-SYNOLOGY.md");
  assert.match(doc, /## Cursusonderhoud/);
  for (const needle of ["jehova-maintenance", "MAINTENANCE_DATABASE_URL", "JEHOVA_NETWORK", "npm run courses:audit", "--verwacht-database=", "--backup-gemaakt"]) assert.ok(doc.includes(needle), needle);
});
