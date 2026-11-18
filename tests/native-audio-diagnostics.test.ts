import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const server = readFileSync("src/lib/native/audio.server.ts", "utf8");

test("elke reden waarom een opname of oude audio niet selecteerbaar is, staat vast en loopt via het serverlog", () => {
  for (const reason of ["opname_niet_toegankelijk", "opname_hoort_bij_ander_hoofdstuk", "opname_niet_gepubliceerd", "oude_audio_niet_gespiegeld_naar_server", "tekst_gewijzigd_audio_ter_controle", "gespiegeld_bestand_komt_niet_overeen", "geen_audiocontrole_vastgelegd", "tekst_wijkt_af_van_audiocontrole", "versmarkeringen_ontbreken", "versmarkeringen_onvolledig", "bestand_ontbreekt_op_server", "opslag_niet_beschikbaar"])
    assert.ok(server.includes(`"${reason}"`), reason);
  assert.match(server, /console\.info\("\[native-audio\] bron weggelaten"/);
});

test("het serverlog bevat geen paden, sessies of bytes", () => {
  const line = /console\.info\("\[native-audio\] bron weggelaten",\{([^}]*)\}/.exec(server)?.[1] ?? "";
  assert.equal(line.replace(/\s/g, ""), "hoofdstuk:authorityChapterId,taal:edition.language,reden:skipReason(error)");
});

test("zonder opname meldt de speler waarom alleen de toestelstem klinkt, in alle talen", () => {
  assert.match(readFileSync("src/components/ReadAloudPlayer.tsx", "utf8"), /player\.nativeNoRecording/);
  for (const language of ["nl", "en", "de", "fr", "es"]) assert.match(readFileSync(`src/lib/i18n/messages/${language}.ts`, "utf8"), /"?nativeNoRecording"?: "[^"]{20,}"/, language);
});
