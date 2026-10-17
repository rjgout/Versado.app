// De gedeelde profielcomponenten (src/components/profile/settings.tsx): de
// toegankelijkheid die elke profielpagina erft. Gerenderd naar HTML met
// react-dom/server, zonder browser.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProfileCard,
  SettingsButton,
  SettingsField,
  SettingsRow,
  SettingsSection,
  SettingsStatus,
  SettingsToggleRow,
} from "../src/components/profile/settings";

const noop = () => {};

test("een schakelaar is een echte checkbox met role=switch, gekoppeld aan zijn uitleg", () => {
  const html = renderToStaticMarkup(h(SettingsToggleRow, { label: "Sociaal", description: "Verzoeken en uitdagingen", checked: true, onChange: noop }));
  assert.match(html, /^<label/);
  assert.match(html, /<input type="checkbox" role="switch"[^>]*checked=""/);
  const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  assert.ok(describedBy, "uitleg niet gekoppeld");
  assert.ok(html.includes(`id="${describedBy}"`), "uitleg-id ontbreekt");
  assert.doesNotMatch(html, /disabled=""/);
});

test("disabled is echt uit, busy houdt het veld focusbaar", () => {
  const off = renderToStaticMarkup(h(SettingsToggleRow, { label: "Push", checked: false, disabled: true, onChange: noop }));
  assert.match(off, /<input[^>]*disabled=""/);
  const busy = renderToStaticMarkup(h(SettingsToggleRow, { label: "Push", checked: false, busy: true, onChange: noop }));
  assert.doesNotMatch(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
});

test("een rij is een link met href, anders een knop, met waarde en pijl", () => {
  const link = renderToStaticMarkup(h(SettingsRow, { label: "Wachtwoord wijzigen", href: "/change-password" }));
  assert.match(link, /^<a [^>]*href="\/change-password"/);
  const button = renderToStaticMarkup(h(SettingsRow, { label: "Taal", value: "Nederlands", onClick: noop }));
  assert.match(button, /^<button type="button"/);
  assert.ok(button.includes("Nederlands"));
  assert.match(button, /aria-hidden="true"/);
});

test("een veld met htmlFor krijgt een echt label", () => {
  const html = renderToStaticMarkup(h(SettingsField, { label: "Huidig wachtwoord", htmlFor: "pw", children: h("input", { id: "pw" }) }));
  assert.match(html, /<label for="pw"[^>]*>Huidig wachtwoord<\/label>/);
});

test("een sectie met titel is een gelabelde section", () => {
  const html = renderToStaticMarkup(h(SettingsSection, { title: "Meldingskanalen", children: h("p", null, "rij") }));
  const labelledBy = /<section aria-labelledby="([^"]+)"/.exec(html)?.[1];
  assert.ok(labelledBy);
  assert.match(html, new RegExp(`<h2 id="${labelledBy}"[^>]*>Meldingskanalen</h2>`));
  const plain = renderToStaticMarkup(h(ProfileCard, { children: h("p", null, "inhoud") }));
  assert.doesNotMatch(plain, /aria-labelledby/);
});

test("fouten worden voorgelezen, andere meldingen als status", () => {
  assert.match(renderToStaticMarkup(h(SettingsStatus, { kind: "error", children: "Mislukt" })), /^<p role="alert"/);
  assert.match(renderToStaticMarkup(h(SettingsStatus, { kind: "success", children: "Opgeslagen" })), /^<p role="status"/);
});

test("knoppen zijn standaard type=button; submit alleen als gevraagd", () => {
  assert.match(renderToStaticMarkup(h(SettingsButton, null, "Annuleren")), /^<button type="button"/);
  assert.match(renderToStaticMarkup(h(SettingsButton, { type: "submit", variant: "primary" }, "Opslaan")), /^<button type="submit"/);
  assert.match(renderToStaticMarkup(h(SettingsButton, { variant: "danger" }, "Resetten")), /text-vs-danger/);
});

test("Jouw gids: eigen profielonderdeel, compacte rij onder Weergave en geen grote sectie op het overzicht", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseProfileView, profileViewHref, PROFILE_VIEWS } = await import("../src/lib/profileViews");
  assert.equal(parseProfileView("guide"), "guide");
  assert.equal(profileViewHref("guide"), "/profile?view=guide");
  assert.equal(PROFILE_VIEWS.guide.title, "companion.profileTitle");
  const client = readFileSync(new URL("../src/components/ProfileClient.tsx", import.meta.url), "utf8");
  assert.equal((client.match(/<CompanionSection/g) ?? []).length, 1, "alleen op de gidspagina");
  assert.ok(client.indexOf('openView("guide")') > client.indexOf("<ThemePreference") && client.indexOf('openView("guide")') < client.indexOf('openView("language")'), "na Weergave, vóór Taal");
});
