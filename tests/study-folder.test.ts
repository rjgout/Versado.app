import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeFolderCursor, encodeFolderCursor, normalizeFolderQuery, StudyFolderError } from "../src/lib/annotations/studyFolder";
import { studyFolderReturn } from "../src/lib/annotations/studyFocus";
import { isFocusRoute, isActivityRoute } from "../src/lib/focusMode";
import { activeDestination } from "../src/lib/navigation";
import { classifyContentRoute } from "../src/lib/contentRouting";
import { nl } from "../src/lib/i18n/messages/nl";
import { ANNOTATION_COLORS } from "../src/lib/annotations/clientContract";
import { annotationColor } from "../src/lib/annotations/contract";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("zoekterm: NFC, witruimte, lengtegrens; leeg is geen filter", () => {
  assert.equal(normalizeFolderQuery("  Jézus \n  Christus "), "Jézus Christus");
  assert.equal(normalizeFolderQuery("   "), undefined);
  assert.equal(normalizeFolderQuery(undefined), undefined);
  assert.throws(() => normalizeFolderQuery("x".repeat(101)), StudyFolderError);
});

test("cursor: round-trip, gebonden aan gebruiker en filters, strikt gevalideerd", () => {
  const row = { createdAt: new Date("2026-03-04T05:06:07.089Z"), kind: "note" as const, id: "abc_123" };
  const cursor = encodeFolderCursor("u1", { q: "x", type: "note" }, row);
  assert.deepEqual({ ...decodeFolderCursor("u1", { q: "x", type: "note" }, cursor) }, { t: "2026-03-04T05:06:07.089Z", k: "note", i: "abc_123", h: decodeFolderCursor("u1", { q: "x", type: "note" }, cursor).h });
  for (const [user, filters] of [["u2", { q: "x", type: "note" as const }], ["u1", { q: "y", type: "note" as const }], ["u1", { q: "x" }], ["u1", { q: "x", type: "note" as const, source: "s" }]] as const)
    assert.throws(() => decodeFolderCursor(user, filters, cursor), StudyFolderError);
  for (const bad of ["", "!!", "a".repeat(401), Buffer.from("[]").toString("base64url"), Buffer.from(JSON.stringify({ t: "2026-03-04", k: "note", i: "x", h: "z" })).toString("base64url")])
    assert.throws(() => decodeFolderCursor("u1", {}, bad), StudyFolderError);
});

test("terugkeer is uitsluitend een eigen /study-folder-pad", () => {
  assert.equal(studyFolderReturn("/study-folder?type=note&q=a%20b"), "/study-folder?type=note&q=a%20b");
  for (const bad of [undefined, null, "", "//x.example", "/\\x", "https://x.example/study-folder", "/study-folders", "/lesson/1"]) assert.equal(studyFolderReturn(bad), null);
});

test("route: focusroute met terugbalk, geen activiteit, onderdeel van Leren, contentneutraal", () => {
  assert.equal(isFocusRoute("/study-folder"), true);
  assert.equal(isActivityRoute("/study-folder"), false);
  assert.equal(activeDestination("/study-folder"), "learn");
  assert.deepEqual(classifyContentRoute("/study-folder"), { kind: "neutral" });
  assert.match(read("src/components/SubpageBackBar.tsx"), /pathname === "\/study-folder"\) return \{ fallback: "\/content", title: "studyFolder\.title" \}/);
});

test("contentkiezer: kaart staat vóór de taalkeuze, is een gewone link en roept geen selectie aan", () => {
  const picker = read("src/components/content/ContentPickerView.tsx");
  const card = picker.indexOf("data-study-folder-entry");
  assert.ok(card > picker.lastIndexOf("data-content-group"), "na de contentgroepen");
  assert.ok(card < picker.indexOf("<section data-content-language"), "vóór de taalkeuze");
  assert.ok(card > picker.indexOf("data-content-group={group}"), "na de groepen-loop");
  const block = picker.slice(card, picker.indexOf("<section data-content-language"));
  assert.match(block, /<AppLink data-study-folder-link href=\{links\.studyFolder\}/);
  assert.match(read("src/components/content/FullscreenContentPicker.tsx"), /studyFolder: "\/study-folder"/);
  assert.doesNotMatch(block, /choose\(|select\(|onClick|works\./);
});

test("Leren en Hulpmiddelen krijgen geen studiemapingang; /bookmarks stuurt door", () => {
  assert.doesNotMatch(read("src/components/CoursesClient.tsx"), /study-folder/);
  assert.doesNotMatch(read("src/app/courses/page.tsx"), /study-folder/);
  const tools = read("src/app/tools/page.tsx");
  assert.doesNotMatch(tools, /\/bookmarks|study-folder|bookmarksText/);
  assert.match(read("src/app/bookmarks/page.tsx"), /redirect\("\/study-folder\?type=bookmark"\)/);
});

test("de API gebruikt alleen de ingelogde gebruiker en geen client-userId", () => {
  const route = read("src/app/api/study-folder/route.ts");
  assert.match(route, /getCurrentUser\(\)/);
  assert.doesNotMatch(route, /userId/);
  const service = read("src/lib/annotations/studyFolder.ts");
  assert.equal((service.match(/"userId" = \$\{actor\.id\}|x\."userId" = \$\{actor\.id\}/g) ?? []).length >= 4, true);
  assert.doesNotMatch(service, /\$queryRawUnsafe|\$executeRawUnsafe/);
});

test("studiemap gebruikt de live-datalaag accountbreed, zonder contentScoped", () => {
  const client = read("src/components/study-folder/StudyFolderClient.tsx");
  assert.match(client, /scopes: \["annotations"\]/);
  assert.doesNotMatch(client, /contentScoped/);
  assert.match(client, /AnnotationActions/);
  assert.doesNotMatch(client, /setInterval|visibilitychange|window\.location\.reload/);
});

test("teksten bestaan in nl als bron; sleutels voor studiemap zijn aanwezig", () => {
  const folder = (nl as unknown as { studyFolder: Record<string, unknown> }).studyFolder;
  for (const key of ["title", "intro", "searchLabel", "open", "edit", "loadMore", "noResults", "sourceUnavailable", "originalPassage", "revisionChanged", "readerChanged", "readerMissing"])
    assert.equal(typeof folder[key], "string", key);
});

test("kleurfilter: één kleurlijst voor client, schrijf-API en filter; cursor is aan de kleur gebonden", () => {
  assert.deepEqual([...ANNOTATION_COLORS], ["yellow", "green", "blue", "pink", "purple"]);
  assert.deepEqual(annotationColor.options, [...ANNOTATION_COLORS]);
  for (const bad of ["red", "", "YELLOW", "yellow;--"]) assert.equal(annotationColor.safeParse(bad).success, false);
  const row = { createdAt: new Date("2026-03-04T05:06:07.089Z"), kind: "highlight" as const, id: "abc" };
  const cursor = encodeFolderCursor("u1", { type: "highlight", color: "yellow" }, row);
  assert.doesNotThrow(() => decodeFolderCursor("u1", { type: "highlight", color: "yellow" }, cursor));
  for (const filters of [{ type: "highlight" as const, color: "blue" as const }, { type: "highlight" as const }, {}])
    assert.throws(() => decodeFolderCursor("u1", filters, cursor), StudyFolderError);
});

test("kleurweergave: tokens voor licht en donker, swatch en niet-kleurkenmerken in de CSS en componenten", () => {
  const css = read("src/app/globals.css");
  for (const color of ANNOTATION_COLORS) {
    assert.match(css, new RegExp(`--vs-mark-${color}: \\d+ \\d+ \\d+;`));
    assert.match(css, new RegExp(`\\[data-annotation-color="${color}"\\], \\[data-mark-swatch="${color}"\\]`));
  }
  assert.equal((css.match(new RegExp(`--vs-mark-yellow: `, "g")) ?? []).length, 2, "licht en donker hebben elk een eigen basiskleur");
  assert.match(css, /\[data-annotation-color\] \{[^}]*linear-gradient/, "kleurbalk als niet-kleurkenmerk");
  assert.match(read("src/components/annotations/StudyAnnotations.tsx"), /text-decoration:underline/);
  assert.match(read("src/components/annotations/MarkSwatch.tsx"), /aria-hidden/);
  assert.match(read("src/components/annotations/AnnotationActions.tsx"), /<MarkSwatch color=\{color\} checked=/);
  assert.match(read("src/components/study-folder/StudyFolderClient.tsx"), /data-folder-color=/);
});
