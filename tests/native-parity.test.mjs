import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { inspectModule, routeFor, domainFor, collectParity, renderInventory, updateDocument } from "../scripts/native/parity.mjs";

test("inventaris behandelt dynamische routes, groepen, parallelle routes en root", () => {
  assert.equal(routeFor("src/app/page.tsx"), "/");
  assert.equal(routeFor("src/app/(account)/profile/page.tsx"), "/profile");
  assert.equal(routeFor("src/app/(learn)/@reader/lesson/[chapterId]/page.tsx"), "/lesson/[chapterId]");
  assert.equal(routeFor("src/app/api/v1/native/[...path]/route.ts"), "/api/v1/native/[...path]");
});
test("alleen een module-directive is een clientgrens, geen commentaar of geneste functie", () => {
  assert.equal(inspectModule("a.tsx", '// "use client"\nexport default function A() { return <div/>; }').boundary, "context-dependent");
  assert.equal(inspectModule("a.tsx", '"use strict"; "use client"; export default function A() { return <div/>; }').boundary, "client");
  assert.equal(inspectModule("a.tsx", 'function inner() { "use client"; }').boundary, "context-dependent");
});
test("exportvarianten en dynamische imports worden niet ongemerkt overgeslagen", () => {
  const info = inspectModule("route.ts", `
    import { current } from "@/lib/session";
    export async function GET() { requireAccount(); return fetchJson("/api/profile"); }
    export const PATCH = handler;
    export { handler as DELETE };
    const loaded = import("./local");
  `);
  assert.deepEqual(info.methods, ["DELETE", "GET", "PATCH"]);
  assert.deepEqual(info.imports, ["./local", "@/lib/session"]);
  assert.deepEqual(info.checks, ["requireAccount"]);
  assert.deepEqual(info.requests, ["/api/profile"]);
  assert.notEqual(info.sha256, inspectModule("route.ts", "export function GET() {}").sha256);
});
test("beheer, groepen, Dorp en native auth krijgen afzonderlijke beleidsgebieden", () => {
  assert.equal(domainFor("/api/admin/users/[id]"), "beheer");
  assert.equal(domainFor("/api/groups/[id]"), "sociaal");
  assert.equal(domainFor("/api/v1/native/[...path]"), "native-kern");
  assert.equal(domainFor("/dorp/groups/[groupId]"), "dorp");
  assert.equal(domainFor("/word-search/[id]"), "spelen");
});
test("regeneratie behoudt handmatige functiebeoordeling en overschrijft geen kapotte markers", () => {
  const generated = "<!-- BEGIN NATIVE PARITY INVENTORY -->\nnieuw\n<!-- END NATIVE PARITY INVENTORY -->";
  const source = "menselijke beoordeling\n<!-- BEGIN NATIVE PARITY INVENTORY -->\noud\n<!-- END NATIVE PARITY INVENTORY -->\nslot\n";
  assert.equal(updateDocument(source, generated), `menselijke beoordeling\n${generated}\nslot\n`);
  assert.throws(() => updateDocument("menselijke tekst\n<!-- BEGIN NATIVE PARITY INVENTORY -->", generated), /Onvolledige/);
});
test("de echte bronboom, alle API-methoden en profielsubschermen zijn in de actuele matrix opgenomen", () => {
  const inventory = collectParity();
  const source = readFileSync("docs/NATIVE-FEATURE-PARITY.md", "utf8");
  assert.equal(updateDocument(source, renderInventory(inventory)), source);
  assert.deepEqual(JSON.parse(readFileSync("docs/native-feature-parity.inventory.json", "utf8")), inventory);
  assert.ok(inventory.routes.some(route => route.route === "/adminbackend/content/study-publications"));
  assert.ok(inventory.routes.some(route => route.route === "/study-lesson/[lessonId]/[collectionId]/stappen/[stap]"));
  assert.ok(inventory.routes.some(route => route.route === "/api/v1/native/[...path]" && route.methods.includes("POST")));
  assert.ok(inventory.profileViews.includes("/profile?view=twoFactor"));
  assert.ok(inventory.socketEvents.includes("submit_answer"));
  assert.ok(inventory.components.some(module => module.file === "src/app/layout.tsx"));
  assert.ok(inventory.components.some(module => module.file === "src/components/ProfileClient.tsx"));
  assert.match(source, /geen onafhankelijke acceptatie-audit/);
  assert.match(source, /release.*geblokkeerd/i);
});
