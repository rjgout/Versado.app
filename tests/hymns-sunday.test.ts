import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isSundayInTimeZone } from "../src/lib/hymns/sunday";

test("zondag begint en eindigt op de lokale daggrens, niet op UTC of de serverdag", () => {
  assert.equal(isSundayInTimeZone(new Date("2026-10-17T21:59:00Z"), "Europe/Amsterdam"), false);
  assert.equal(isSundayInTimeZone(new Date("2026-10-17T22:00:00Z"), "Europe/Amsterdam"), true);
  assert.equal(isSundayInTimeZone(new Date("2026-10-18T21:59:00Z"), "Europe/Amsterdam"), true);
  assert.equal(isSundayInTimeZone(new Date("2026-10-18T22:00:00Z"), "Europe/Amsterdam"), false);
});

test("andere tijdzones kiezen onafhankelijk hun eigen zondag", () => {
  const instant = new Date("2026-10-18T00:30:00Z");
  assert.equal(isSundayInTimeZone(instant, "Europe/Amsterdam"), true);
  assert.equal(isSundayInTimeZone(instant, "America/Los_Angeles"), false);
  assert.equal(isSundayInTimeZone(new Date("2026-10-17T15:01:00Z"), "Asia/Tokyo"), true);
});

test("zondag blijft correct bij omschakeling van zomer- naar wintertijd", () => {
  assert.equal(isSundayInTimeZone(new Date("2026-10-24T21:59:00Z"), "Europe/Amsterdam"), false);
  assert.equal(isSundayInTimeZone(new Date("2026-10-24T22:00:00Z"), "Europe/Amsterdam"), true);
  assert.equal(isSundayInTimeZone(new Date("2026-10-25T22:59:00Z"), "Europe/Amsterdam"), true);
  assert.equal(isSundayInTimeZone(new Date("2026-10-25T23:00:00Z"), "Europe/Amsterdam"), false);
});

test("de server bepaalt toegang; zondagkaart verandert nooit de actieve bron", () => {
  const today = readFileSync(new URL("../src/lib/today.ts", import.meta.url), "utf8");
  const section = readFileSync(new URL("../src/components/today/TodaySection.tsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../src/components/content/FullscreenContentPicker.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");

  assert.match(today, /isSundayInTimeZone\(new Date\(\), timeZone\) && \(await getHymnsAccess\(user\)\) === "allow"/);
  assert.match(today, /sundayHymns,/);
  assert.match(section, /data-today-hymns href="\/dev\/lofzangen"/);
  assert.match(section, /!dailyText && !wordGame && !dailyQuiz && !sundayHymns/);
  assert.doesNotMatch(section, /contentCollectionId|activeContentCollectionId|liveMutation/);
  assert.match(picker, /data-content-group="music"/);
  assert.doesNotMatch(picker, /group === "studyPrograms" && data\.hymnsAvailable/);
  assert.match(dashboard, /nextLocalMidnight = localDayRange\(dayKeyInZone\(new Date\(serverNow\), timeZone\), timeZone\)\.end/);
  assert.match(dashboard, /\[nextLocalMidnight, data\.wordGame\?\.nextReleaseAt\]/);
});
