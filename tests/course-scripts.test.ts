// De cursusscripts (scripts/courses/*) bepalen de databaseverbinding eenmaal, tonen alleen host/poort/naam en geven dezelfde URL
// expliciet aan de Prisma-client. Zonder database: de weigeringen gebeuren vóór er een verbinding wordt opgebouwd.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { confirmsDatabaseIdentity, formatDatabaseIdentity, resolveDatabase } from "../scripts/courses/target";

const root = resolve(import.meta.dirname, "..");
const SECRET = "geheim-wachtwoord-123";
const URL_A = `postgresql://gebruiker:${SECRET}@db-a.example.invalid:5433/database_a?sslmode=require`;
const URL_B = `postgresql://gebruiker:${SECRET}@db-b.example.invalid/database_b`;

test("resolveDatabase: een expliciete DATABASE_URL gaat voor en het .env wordt dan niet gelezen", () => {
  let loaded = 0;
  const result = resolveDatabase({ DATABASE_URL: URL_A }, () => { loaded++; });
  assert.equal(loaded, 0);
  assert.equal(result.url, URL_A);
  assert.deepEqual(result.label, { host: "db-a.example.invalid", port: "5433", database: "database_a" });
});

test("resolveDatabase: zonder DATABASE_URL wordt het lokale .env gebruikt, zoals src/lib/db.ts", () => {
  const env: Record<string, string | undefined> = {};
  const result = resolveDatabase(env, () => { env.DATABASE_URL = URL_B; });
  assert.equal(result.url, URL_B);
  assert.deepEqual(result.label, { host: "db-b.example.invalid", port: "5432", database: "database_b" });
});

test("resolveDatabase: zonder variabele en zonder .env een duidelijke fout, geen standaardverbinding", () => {
  assert.throws(() => resolveDatabase({}, () => { throw new Error("ENOENT"); }), /DATABASE_URL is niet gezet/);
  assert.throws(() => resolveDatabase({ DATABASE_URL: "geen-url" }), /geen geldige verbindings-URL/);
});

test("het label bevat nooit gebruikersnaam, wachtwoord of query", () => {
  const { label } = resolveDatabase({ DATABASE_URL: URL_A });
  const shown = JSON.stringify(label);
  for (const secret of [SECRET, "gebruiker", "sslmode"]) assert.ok(!shown.includes(secret), secret);
});

function runScript(script: string, args: string[], options: { env: Record<string, string | undefined>; cwd?: string }) {
  const result = spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "scripts/courses", script), ...args], {
    cwd: options.cwd ?? root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...options.env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test("--apply weigert bij elke ontbrekende of afwijkende database-identiteit, zonder te verbinden", () => {
  const env = { DATABASE_URL: URL_A }; // db-a.example.invalid:5433/database_a
  const refusals: Array<[string, string[]]> = [
    ["ontbrekende bevestiging", []],
    ["alleen de databasenaam (oud formaat)", ["--verwacht-database=database_a"]],
    ["juiste naam, verkeerde host", ["--verwacht-database=db-b.example.invalid:5433/database_a"]],
    ["juiste host en naam, verkeerde poort", ["--verwacht-database=db-a.example.invalid:5432/database_a"]],
    ["juiste host en poort, verkeerde naam", ["--verwacht-database=db-a.example.invalid:5433/database_b"]],
    ["hoofdletters wijken af", ["--verwacht-database=DB-A.example.invalid:5433/database_a"]],
    ["lege bevestiging", ["--verwacht-database="]],
  ];
  for (const [name, extra] of refusals) {
    const result = runScript("repair-duplicates.ts", ["--apply", "--backup-gemaakt", ...extra], { env });
    assert.equal(result.status, 2, `${name}: ${result.out}`);
    assert.match(result.out, /--verwacht-database=db-a\.example\.invalid:5433\/database_a/, name);
    assert.ok(!result.out.includes(SECRET), `${name}: geen wachtwoord`);
    assert.ok(!result.out.includes("sslmode") && !result.out.includes("gebruiker"), `${name}: geen query of gebruikersnaam`);
  }
});

test("--apply vereist nog steeds de back-upbevestiging, ook met een juiste database-identiteit", () => {
  const result = runScript("repair-duplicates.ts", ["--apply", "--verwacht-database=db-a.example.invalid:5433/database_a"], { env: { DATABASE_URL: URL_A } });
  assert.equal(result.status, 2);
  assert.match(result.out, /--backup-gemaakt/);
});

test("de volledige identiteit gaat boven de naam: confirmsDatabaseIdentity is exact", () => {
  const label = { host: "db-a.example.invalid", port: "5433", database: "database_a" };
  assert.equal(formatDatabaseIdentity(label), "db-a.example.invalid:5433/database_a");
  assert.ok(confirmsDatabaseIdentity(label, "db-a.example.invalid:5433/database_a"));
  for (const wrong of [undefined, "", "database_a", "db-a.example.invalid:5433", "db-a.example.invalid:5433/database_a ", "x:5433/database_a"]) assert.ok(!confirmsDatabaseIdentity(label, wrong), String(wrong));
});

test("zonder DATABASE_URL en zonder .env stoppen audit en herstel met een duidelijke fout", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursusscripts-"));
  try {
    for (const script of ["audit-duplicates.ts", "repair-duplicates.ts"]) {
      const result = runScript(script, [], { env: {}, cwd: dir });
      assert.notEqual(result.status, 0, script);
      assert.match(result.out, /DATABASE_URL is niet gezet/, script);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("een lokaal .env wordt gebruikt en getoond, zonder geheimen; de verbinding wordt pas daarna geprobeerd", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursusscripts-"));
  try {
    writeFileSync(join(dir, ".env"), `DATABASE_URL="postgresql://gebruiker:${SECRET}@127.0.0.1:1/env_database"\n`);
    for (const script of ["audit-duplicates.ts", "repair-duplicates.ts"]) {
      const result = runScript(script, [], { env: {}, cwd: dir });
      assert.match(result.out, /Doeldatabase.*127\.0\.0\.1:1\/env_database/, script);
      assert.ok(!result.out.includes(SECRET), `${script}: geen wachtwoord in de uitvoer`);
    }
    // Ook de bevestiging gebruikt de database uit .env.
    const refused = runScript("repair-duplicates.ts", ["--apply", "--backup-gemaakt", "--verwacht-database=127.0.0.1:1/anders"], { env: {}, cwd: dir });
    assert.equal(refused.status, 2);
    assert.match(refused.out, /--verwacht-database=127\.0\.0\.1:1\/env_database/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("een expliciete DATABASE_URL wint van een lokaal .env", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursusscripts-"));
  try {
    writeFileSync(join(dir, ".env"), "DATABASE_URL=postgresql://x:y@127.0.0.1:1/env_database\n");
    const result = runScript("repair-duplicates.ts", ["--apply", "--backup-gemaakt"], { env: { DATABASE_URL: URL_A }, cwd: dir });
    assert.match(result.out, /database_a/);
    assert.ok(!result.out.includes("env_database"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("de scripts geven de vastgestelde URL expliciet aan createPrismaClient", async () => {
  const { readFileSync } = await import("node:fs");
  for (const script of ["audit-duplicates.ts", "repair-duplicates.ts"]) {
    const source = readFileSync(join(root, "scripts/courses", script), "utf8");
    assert.match(source, /createPrismaClient\(\{ url: database\.url \}\)/, script);
    assert.doesNotMatch(source, /createPrismaClient\(\)/, script);
    assert.ok(source.indexOf("resolveDatabase()") < source.indexOf("createPrismaClient("), `${script}: eerst vaststellen, dan de client`);
  }
});
