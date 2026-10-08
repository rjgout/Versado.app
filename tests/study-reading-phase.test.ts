import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const server = readFileSync(resolve(root, "src/server/study.ts"), "utf8");
const units = readFileSync(resolve(root, "src/lib/study/units.ts"), "utf8");
const room = readFileSync(resolve(root, "src/components/study/StudyRoom.tsx"), "utf8");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");

test("een gekozen stap begint server-authoritative in de leesfase", () => {
  assert.match(server, /phase: "READING"/);
  assert.match(server, /socket\.on\("st:begin_questions"/);
  assert.match(server, /room\.hostId !== userId/);
  assert.match(schema, /enum StudyRoundPhase[\s\S]*READING[\s\S]*QUESTIONS/);
});

test("alleen de vraagfase accepteert antwoorden en bewaart de bestaande scoreflow", () => {
  assert.match(server, /round\.phase !== "QUESTIONS"/);
  assert.match(server, /completeStudyRound/);
  assert.match(server, /scoreRound/);
});

test("leeslessen beperken de gezamenlijke inhoud tot hun eigen versbereik", () => {
  assert.match(units, /verse\.number >= lesson\.startVerse && verse\.number <= lesson\.endVerse/);
  assert.match(units, /kind: "scripture"/);
});

test("de leesfase heeft een host-CTA, een wachtstatus en een secundaire skip", () => {
  assert.match(room, /study\.toQuestions/);
  assert.match(room, /study\.skipReading/);
  assert.match(room, /study\.waitingForQuestions/);
  assert.match(room, /st:skip_reading/);
});
