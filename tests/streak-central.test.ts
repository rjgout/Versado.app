import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// De dagelijkse reeks heeft één regel en één ingang: recordLearningActivity.
// Deze tests bewaken dat geen spel of pagina een eigen reeksupdate bijhoudt
// en dat de uitleg niet terugvalt op de oude "alleen oefenen" formulering.

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "generated") continue;
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("alleen de centrale reekslaag schrijft reeksdagen of verhoogt de reeks", () => {
  const allowed = new Set(["src/lib/streak.ts", "src/lib/streakContinuation.ts", "src/lib/streakCelebration.ts"]);
  for (const file of files("src")) {
    const source = readFileSync(file, "utf8");
    if (allowed.has(file)) continue;
    assert.ok(!/streakDay\.(upsert|create|update)/.test(source), `${file} schrijft een reeksdag`);
    assert.ok(!/currentStreak:\s*\{\s*increment/.test(source), `${file} verhoogt de reeks zelf`);
  }
});

test("alleen de centrale reeksregel beslist of een activiteit telt", () => {
  const rule = readFileSync("src/lib/learning/streakRules.ts", "utf8");
  assert.ok(!/kind === "READING"/.test(rule), "geen aparte uitzondering voor lezen meer");
  const streak = readFileSync("src/lib/streak.ts", "utf8");
  assert.equal(streak.match(/qualifiesForStreak\(/g)?.length, 1, "één plek roept de regel aan");
});

test("clients werken de reeks niet zelf bij", () => {
  for (const file of files("src/components")) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/currentStreak\s*(\+\+|\+=)/.test(source), `${file} verhoogt de reeks in de client`);
  }
});

test("Woordzoeker blijft de gedocumenteerde tijdelijke uitzondering", () => {
  const doc = readFileSync("docs/LEERVOORTGANG.md", "utf8");
  assert.ok(/Woordzoeker/.test(doc) && /tijdelijke uitzondering/i.test(doc));
  const game = readFileSync("src/lib/wordSearch/game.ts", "utf8");
  assert.ok(!/recordLearningActivity|finishActivity/.test(game), "Woordzoeker is in dit werk niet aangepast");
});

test("de uitleg noemt geen verouderde reeksregel meer", () => {
  const sources = ["nl", "en", "de", "fr", "es"].flatMap((lang) => [`src/lib/i18n/messages/${lang}.ts`, `src/lib/i18n/messages/kompas/${lang}.ts`]);
  const outdated = [
    /Alleen lezen telt niet/i, /Reading alone does not/i, /Lezen telt mee voor je voortgang; XP en je reeks verdien je met de oefeningen/,
    /verlengt je reeks niet/, /doesn.t extend your streak/i, /elke dag te oefenen/, /by practicing every day/i,
  ];
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    for (const pattern of outdated) assert.ok(!pattern.test(source), `${file}: ${pattern}`);
  }
});

test("de reeksuitleg noemt de centrale regel in alle talen", () => {
  const needles: Record<string, RegExp> = {
    nl: /minstens één echte activiteit/, en: /at least one real activity/, de: /mindestens eine echte Aktivität/,
    fr: /au moins une vraie activité/, es: /al menos una actividad real/,
  };
  for (const [lang, needle] of Object.entries(needles)) {
    assert.ok(needle.test(readFileSync(`src/lib/i18n/messages/kompas/${lang}.ts`, "utf8")), lang);
  }
});

test("de Legpuzzel-uitleg beschrijft twee delen en dat de puzzel geen XP geeft, in alle talen", () => {
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const source = readFileSync(`src/lib/i18n/messages/${lang}.ts`, "utf8");
    for (const key of ["questionIntro", "correct", "incorrect", "correctWas", "alreadyAnswered", "notComplete", "another"]) {
      assert.ok(new RegExp(`"?${key}"?:`).test(source), `${lang}: jigsaw.${key}`);
    }
  }
});
