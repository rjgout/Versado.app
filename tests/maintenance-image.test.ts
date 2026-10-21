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

test("de Portainer-stack pint de image op digest, vereist expliciete variabelen en bevat geen algemene DATABASE_URL", () => {
  const stack = code(read("deploy/maintenance-stack.yml"));
  // Image: alleen op digest, verplichte variabele, geen tag en nooit latest.
  assert.match(stack, /image: ghcr\.io\/rjgout\/jehova-maintenance@\$\{MAINTENANCE_IMAGE_DIGEST:\?[^}]+\}/);
  assert.doesNotMatch(stack, /ghcr\.io\/rjgout\/jehova-maintenance:/, "geen tag, ook niet latest");
  assert.doesNotMatch(stack, /latest/i);
  assert.doesNotMatch(stack, /MAINTENANCE_IMAGE_DIGEST:-/, "geen standaardwaarde voor de digest");
  // Alleen-lezen verbinding verplicht; schrijfverbinding apart en standaard leeg; geen algemene DATABASE_URL.
  assert.match(stack, /COURSES_READONLY_DATABASE_URL: \$\{MAINTENANCE_READONLY_DATABASE_URL:\?/);
  assert.match(stack, /COURSES_REPAIR_DATABASE_URL: \$\{MAINTENANCE_REPAIR_DATABASE_URL:-\}/);
  assert.doesNotMatch(stack, /^\s+DATABASE_URL:/m, "de onderhoudsstack kent geen algemene (schrijf)verbinding");
  assert.match(stack, /JEHOVA_NETWORK:\?/);
  assert.match(stack, /restart: "no"/);
  for (const forbidden of [/^\s*ports:/m, /^\s*volumes:/m, /docker\.sock/, /privileged/, /network_mode/, /^\s*pid:/m, /^\s*devices:/m]) assert.doesNotMatch(stack, forbidden, String(forbidden));
  assert.match(stack, /cap_drop:\n\s+- ALL/);
  assert.match(stack, /no-new-privileges:true/);
  assert.doesNotMatch(stack, /postgresql:\/\/[^$\s]/, "geen vaste verbindings-URL of wachtwoord in het bestand");
});

test("de workflow toont de digest van elke gepubliceerde image (om op te pinnen)", () => {
  const workflow = code(read(".github/workflows/docker-publish.yml"));
  assert.match(workflow, /id: build\n\s+uses: docker\/build-push-action/);
  assert.match(workflow, /steps\.build\.outputs\.digest/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});

test("de alleen-lezen rol: minimale rechten, geen wachtwoord in Git, en de documentatie bevat exact dit SQL-bestand", () => {
  const sql = read("scripts/courses/readonly-role.sql");
  const statements = code(sql.replace(/^--.*$/gm, "#"));
  assert.match(statements, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(statements, /default_transaction_read_only = on/);
  assert.match(statements, /statement_timeout/);
  assert.doesNotMatch(statements, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL PRIVILEGES|CREATE ON|GRANT ALL|WITH GRANT OPTION)\b/i, "alleen leesrechten");
  assert.ok([...statements.matchAll(/^GRANT (\w+)/gm)].every((match) => ["CONNECT", "USAGE", "SELECT"].includes(match[1])));
  // Persoonsgevoelige tabellen alleen op kolommen.
  assert.match(statements, /GRANT SELECT \("id", "activeCourseId"\) ON "User"/);
  assert.match(statements, /GRANT SELECT \("id", "courseId", "lessonId"\) ON "Feedback"/);
  assert.doesNotMatch(statements, /ON[^;]*"User"[^;]*;[\s\S]*GRANT SELECT ON[^;]*"User"/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /PASSWORD/i, "het SQL-bestand bevat geen wachtwoord");
  assert.doesNotMatch(sql, /:'wachtwoord'|-v wachtwoord/, "het wachtwoord is geen psql-variabele of commandoregelargument");
  assert.match(statements, /CREATE ROLE :"rolnaam" NOLOGIN /, "de rol kan pas inloggen na een bewust ingesteld wachtwoord en LOGIN");
  const doc = read("docs/DEPLOY-SYNOLOGY.md");
  const block = doc.match(/```sql\n([\s\S]*?)\n```/)?.[1];
  assert.ok(block, "SQL-blok in de documentatie");
  assert.equal(block!.trim(), sql.trim(), "de documentatie en scripts/courses/readonly-role.sql zijn identiek");
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
    "readonly-role.sql",
    "COURSES_READONLY_DATABASE_URL",
    "Geen schrijfverbinding",
    "PostgreSQL liet de alleen-lezen gebruiker toe",
    "heeft databasegegevens gewijzigd",
  ]) assert.ok(script.includes(needle), needle);
  assert.match(script, /alleen een lokale wegwerpdatabase/, "weigert elke andere database dan een lokale wegwerpdatabase");
  // Nooit een echt herstel: geen schrijfverbinding voor --apply, en de enige --apply met bevestiging draait met uitsluitend de alleen-lezen verbinding (faalt dus).
  assert.doesNotMatch(script, /COURSES_REPAIR_DATABASE_URL/);
  for (const line of script.split("\n").filter((entry) => entry.includes("--verwacht-database"))) assert.match(line, /COURSES_READONLY_DATABASE_URL="\$RO_URL"/, line);
});

test("de documentatie voert het wachtwoord veilig in: verborgen \\password, nooit als argument, bestand of variabele", () => {
  const doc = read("docs/DEPLOY-SYNOLOGY.md");
  const section = doc.slice(doc.indexOf("## Cursusonderhoud"), doc.indexOf("## Back-ups"));
  assert.match(section, /\\password courses_ro/);
  assert.match(section, /ALTER ROLE courses_ro LOGIN;/);
  // Geen wachtwoord op een commandoregel of in een psql-variabele, en geen tijdelijk bestand om het SQL-bestand of het wachtwoord in te zetten.
  assert.doesNotMatch(section, /-v wachtwoord|wachtwoord=|PASSWORD\s+'|PGPASSWORD|--password|-W\b/);
  assert.doesNotMatch(section, /cat > \/tmp|\/tmp\/readonly-role|<<\s*'?EOF/);
  // Elke psql-commandoregel in de sectie bevat geen geheimen.
  for (const line of section.split("\n").filter((entry) => /^\s*`?psql /.test(entry))) assert.doesNotMatch(line, /wachtwoord|password|PASSWORD/i, line);
  // Het wachtwoord mag in een URL (letters en cijfers) en wordt gegenereerd, niet verzonnen of hardcoded.
  assert.match(section, /openssl rand -hex 24/);
  assert.doesNotMatch(section, /openssl rand -base64/);
});

test("de bestaande productie-compose en de app-image kennen de onderhoudsimage niet", () => {
  for (const file of ["docker-compose.yml", "deploy/docker-compose.yml"]) assert.doesNotMatch(read(file), /maintenance-stack|jehova-maintenance|COURSES_|MAINTENANCE_/, file);
  assert.doesNotMatch(read("deploy/agent/server.js"), /jehova-maintenance/, "de deploy-agent beheert de onderhoudsimage niet");
});

test("de documentatie beschrijft de Portainer-route en verwijst naar de bevestigingen", () => {
  const doc = read("docs/DEPLOY-SYNOLOGY.md");
  assert.match(doc, /## Cursusonderhoud/);
  for (const needle of ["jehova-maintenance", "MAINTENANCE_IMAGE_DIGEST", "MAINTENANCE_READONLY_DATABASE_URL", "MAINTENANCE_REPAIR_DATABASE_URL", "JEHOVA_NETWORK", "npm run courses:audit", "--verwacht-database=", "--backup-gemaakt", "sha256:", "imagetools inspect"]) assert.ok(doc.includes(needle), needle);
});
