import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
// Resolveer vanuit de echte Prisma-configdependency, ook als npm Effect elders nestelt.
const configPackage = require.resolve("@prisma/config/package.json");
const configRequire = createRequire(configPackage);
const effectPackage = configRequire.resolve("effect/package.json");
const patched = version => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 3 || major === 3 && (minor > 22 || minor === 22 && patch >= 1);
};

test("Prisma gebruikt werkelijk een gepatchte Effect; het lockbestand bevat geen kwetsbare kopie", () => {
  const installed = JSON.parse(readFileSync(effectPackage, "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const copies = Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/effect$/.test(path));
  assert.ok(copies.length > 0);
  for (const [path, entry] of copies) assert.ok(patched(entry.version), `Kwetsbare Effect in ${path}`);
  assert.ok(patched(installed.version), "De door Prisma geladen Effect is kwetsbaar");
  const installedPath = relative(process.cwd(), effectPackage).replaceAll("\\", "/").replace(/\/package\.json$/, "");
  assert.equal(lock.packages[installedPath]?.version, installed.version);
});

test("de gepubliceerde ReDoS-invoer wordt begrensd afgewezen, geldige template-invoer blijft werken", () => {
  // Eigen proces: een teruggekeerde kwetsbaarheid kan de testrunner niet blokkeren.
  // Dit is uitsluitend een testdeadline; geen database-, server- of productietimeout.
  const child = spawnSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    const localRequire = require('node:module').createRequire(process.argv[1]);
    const Schema = localRequire('effect/Schema');
    const schema = Schema.TemplateLiteral(Schema.String, ':', Schema.String, ':', Schema.String, 'X');
    assert.equal(Schema.decodeUnknownSync(schema)('a:b:cX'), 'a:b:cX');
    assert.equal(Schema.is(schema)(':'.repeat(100000)), false);
    process.stdout.write('ok');
  `, configPackage], { encoding: "utf8", timeout: 5000 });
  assert.equal(child.error?.code, undefined, "Effect-testproces faalt of overschrijdt de testdeadline");
  assert.equal(child.status, 0, "Effect verwerpt geldige invoer of accepteert ongeldige invoer");
  assert.equal(child.stdout, "ok");
});

test("Prisma-config laden behoudt geldige schema-/migratiepaden en weigert verkeerde schematypen", async () => {
  const { loadConfigFromFile } = require("@prisma/config");
  const root = mkdtempSync(join(tmpdir(), "versado-prisma-effect-"));
  try {
    const valid = join(root, "valid.config.cjs"), invalid = join(root, "invalid.config.cjs");
    writeFileSync(valid, 'module.exports = {schema:"schema.prisma",migrations:{path:"migrations"}};');
    writeFileSync(invalid, 'module.exports = {schema:42};');
    const accepted = await loadConfigFromFile({ configFile: valid, configRoot: root });
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.config.schema, join(root, "schema.prisma"));
    assert.equal(accepted.config.migrations.path, join(root, "migrations"));
    const rejected = await loadConfigFromFile({ configFile: invalid, configRoot: root });
    assert.equal(rejected.error?._tag, "ConfigFileSyntaxError");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
