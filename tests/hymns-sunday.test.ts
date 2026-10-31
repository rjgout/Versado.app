import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isSundayInTimeZone, sundayHymnsVisible, todayRefreshExpiry } from "../src/lib/hymns/sunday";
import { hymnsPocAccess } from "../src/lib/hymns/access";

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

const SUNDAY = new Date("2026-10-18T10:00:00Z");
const SATURDAY = new Date("2026-10-17T10:00:00Z");
const MONDAY = new Date("2026-10-19T10:00:00Z");

test("zaterdag nee, zondag ja (alleen bij toegang), maandag weer nee; op andere dagen wordt de toegang niet eens opgevraagd", async () => {
  let asked = 0;
  const allow = async () => (asked += 1, "allow");
  assert.equal(await sundayHymnsVisible(SATURDAY, "Europe/Amsterdam", allow), false);
  assert.equal(await sundayHymnsVisible(MONDAY, "Europe/Amsterdam", allow), false);
  assert.equal(asked, 0);
  assert.equal(await sundayHymnsVisible(SUNDAY, "Europe/Amsterdam", allow), true);
  assert.equal(asked, 1);
});

test("zondagkaart volgt exact de servergate: beheerder, gebruiker met/zonder toestemming, noodstop en niet ingelogd", async () => {
  const gate = (o: { isAdmin: boolean; visibleToUsers: boolean; flag?: string; loggedIn?: boolean }) =>
    async () => hymnsPocAccess({ flag: o.flag, loggedIn: o.loggedIn ?? true, isAdmin: o.isAdmin, visibleToUsers: o.visibleToUsers });
  const visible = (o: Parameters<typeof gate>[0]) => sundayHymnsVisible(SUNDAY, "Europe/Amsterdam", gate(o));
  assert.equal(await visible({ isAdmin: true, visibleToUsers: false }), true);
  assert.equal(await visible({ isAdmin: false, visibleToUsers: true }), true);
  assert.equal(await visible({ isAdmin: false, visibleToUsers: false }), false);
  assert.equal(await visible({ isAdmin: true, visibleToUsers: true, flag: "0" }), false, "HYMNS_POC=0 blokkeert ook beheerders");
  assert.equal(await visible({ isAdmin: false, visibleToUsers: true, flag: "0" }), false);
  assert.equal(await visible({ isAdmin: false, visibleToUsers: true, loggedIn: false }), false);
});

test("Vandaag ververst zichzelf op de eerstvolgende lokale middernacht, ook op dagen met zomer-/wintertijd", () => {
  const ams = "Europe/Amsterdam";
  // gewone dag: zaterdag 17 okt 12:00 lokaal -> zondag 00:00 lokaal = 22:00Z
  assert.equal(todayRefreshExpiry(new Date("2026-10-17T10:00:00Z"), ams), "2026-10-17T22:00:00.000Z");
  // zondag 25 okt is 25 uur (wintertijd): de volgende middernacht is 23:00Z, niet 22:00Z
  assert.equal(todayRefreshExpiry(new Date("2026-10-25T10:00:00Z"), ams), "2026-10-25T23:00:00.000Z");
  // zondag 29 maart is 23 uur (zomertijd): de volgende middernacht is 22:00Z
  assert.equal(todayRefreshExpiry(new Date("2027-03-28T10:00:00Z"), ams), "2027-03-28T22:00:00.000Z");
  // de nacht van zondag op maandag: net voor middernacht is de grens bijna bereikt
  assert.equal(todayRefreshExpiry(new Date("2026-10-18T21:59:30Z"), ams), "2026-10-18T22:00:00.000Z");
  // andere tijdzone: Los Angeles zit op dat moment nog op zaterdag
  assert.equal(todayRefreshExpiry(new Date("2026-10-18T00:30:00Z"), "America/Los_Angeles"), "2026-10-18T07:00:00.000Z");
  // een eerdere woord-van-de-dag-release blijft voorrang houden, een latere niet
  assert.equal(todayRefreshExpiry(new Date("2026-10-17T10:00:00Z"), ams, "2026-10-17T16:00:00.000Z"), "2026-10-17T16:00:00.000Z");
  assert.equal(todayRefreshExpiry(new Date("2026-10-17T10:00:00Z"), ams, "2026-10-18T16:00:00.000Z"), "2026-10-17T22:00:00.000Z");
});

test("na een dagwisseling klopt de toestand: de verversgrens van zaterdag is het begin van de zondagkaart", async () => {
  const ams = "Europe/Amsterdam";
  const expiry = new Date(todayRefreshExpiry(new Date("2026-10-17T10:00:00Z"), ams));
  const allow = async () => "allow";
  assert.equal(await sundayHymnsVisible(new Date(expiry.getTime() - 1), ams, allow), false);
  assert.equal(await sundayHymnsVisible(expiry, ams, allow), true);
});

test("de kaart verandert nooit de actieve bron en staat gescheiden van de studieprogramma's in de kiezer", () => {
  const section = readFileSync(new URL("../src/components/today/TodaySection.tsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../src/components/content/ContentPickerView.tsx", import.meta.url), "utf8");
  assert.match(section, /data-today-hymns href="\/dev\/lofzangen"/);
  assert.match(section, /!dailyText && !wordGame && !dailyQuiz && !sundayHymns/);
  assert.doesNotMatch(section, /contentCollectionId|activeContentCollectionId|liveMutation|fetch\(/);
  const order = ["scriptures", "music", "studyPrograms"].map((g) => picker.indexOf(`"${g}"`));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], "volgorde Schriften, Zang & muziek, Studieprogramma's");
  assert.match(picker, /data-content-group="music"/);
  assert.doesNotMatch(picker, /group === "studyPrograms" && data\.hymnsAvailable/);
});
