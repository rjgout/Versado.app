import assert from "node:assert/strict";
import test from "node:test";
import { listIndex, loadComposition, loadReadableHymn, loadRecognitionBundle, loadResolvedHymn, loadText, readManifest } from "../src/lib/hymns/library/server";
import { prepareIndex, searchHymns } from "../src/lib/hymns/search";
import { candidatesFromBundle } from "../src/lib/hymns/recognize/candidates";

// De volledige Nederlandse bibliotheek (205 officiële lofzangen), gelezen uit de gegevens in src/lib/hymns/library/data.
// De tests bewaken de volledigheid, de scheiding van lagen en dat onzekere muziek nooit wordt gebruikt.

const manifest = readManifest();
const NUMBERS = manifest.hymns.map((h) => h.number);

test("de bibliotheek bevat precies de 205 officiële lofzangen, genummerd 1 t/m 205 zonder dubbelen of gaten", () => {
  assert.equal(manifest.hymns.length, 205);
  assert.deepEqual(NUMBERS, Array.from({ length: 205 }, (_, i) => i + 1));
  const titles = manifest.hymns.map((h) => h.title);
  assert.ok(titles.every((t) => t.trim().length > 0));
  assert.equal(manifest.hymns.every((h) => h.title === h.title.trim()), true);
});

test("lofzang 54 en 151 zijn officiële licentie-uitzonderingen: nummer blijft, tekst ontbreekt, er wordt niets verzonnen", () => {
  for (const n of [54, 151]) {
    const h = loadReadableHymn(n)!;
    assert.equal(h.text, null);
    assert.equal(h.composition, null);
    assert.equal(h.unavailableReason, "license");
    assert.ok(h.title.length > 0);
    assert.equal(h.capabilities.textComplete, false);
    assert.equal(loadText(n), null);
  }
  assert.equal(manifest.hymns.filter((h) => h.textStatus === "niet-gepubliceerd").length, 2);
});

test("lofzang 86 is volledig leesbaar zonder bladmuziek", () => {
  const h = loadReadableHymn(86)!;
  assert.ok(h.text);
  assert.equal(h.composition, null);
  assert.equal(h.capabilities.sheetMusicAvailable, false);
  assert.equal(h.capabilities.textComplete, true);
  assert.ok(h.text!.stanzas.length >= 2);
});

test("tekst: 203 volledige teksten met genummerde coupletten, geen lege regels en bronvermelding", () => {
  const complete = manifest.hymns.filter((h) => h.textStatus === "volledig");
  assert.equal(complete.length, 203);
  const seen = new Map<string, number>();
  for (const h of complete) {
    const loaded = loadText(h.number)!;
    const t = loaded.text;
    assert.deepEqual(
      t.stanzas.map((s) => s.n),
      t.stanzas.map((_, i) => i + 1),
      `lofzang ${h.number}: coupletnummers`
    );
    for (const s of t.stanzas) {
      assert.ok(s.lines.length >= 2, `lofzang ${h.number} couplet ${s.n}: te weinig regels`);
      for (const l of s.lines) {
        assert.ok(l.text.trim().length > 0);
        assert.equal(l.text, l.text.trim());
        assert.equal(l.words.map((w) => w.w).join(" "), l.text.trim().split(/\s+/).join(" "));
      }
    }
    assert.ok(t.source?.pageUrl.startsWith("https://www.churchofjesuschrist.org/"), `lofzang ${h.number}: bron-URL`);
    assert.match(t.source!.pageSha, /^[0-9a-f]{64}$/);
    assert.ok(t.rights, "rechtenmetadata");
    // geen twee lofzangen met exact dezelfde coupletten (wisselingen of dubbele import)
    const key = t.stanzas.map((s) => s.lines.map((l) => l.text).join("/")).join("#");
    assert.equal(seen.has(key), false, `lofzang ${h.number} heeft dezelfde tekst als ${seen.get(key)}`);
    seen.set(key, h.number);
  }
});

test("tekststructuur: veel coupletten, refrein na elk couplet en een afwijkend refrein worden herkend", () => {
  assert.equal(loadText(100)!.text.stanzas.length, 8);
  assert.equal(loadText(23)!.text.stanzas.length, 7);
  const t24 = loadText(24)!.text;
  assert.ok(t24.chorus && t24.chorus.lines.length === 4);
  assert.equal(loadText(154)!.text.extraChorusVariants, 1);
  // een enkel couplet zonder nummer in de bron blijft couplet 1
  for (const n of [44, 143, 197, 199]) assert.deepEqual(loadText(n)!.text.stanzas.map((s) => s.n), [1]);
});

test("auteurs- en rechteninformatie komt uit de officiële pagina", () => {
  const t24 = loadText(24)!.text;
  assert.ok(t24.musicCredit?.includes("Schotse"));
  assert.ok(manifest.hymns.some((h) => loadText(h.number)?.text.rights?.copyingForbiddenWithoutPermission));
});

test("capaciteiten zijn consistent: woordvolging impliceert regelvolging, die impliceert gevalideerde bladmuziek en een compositie", () => {
  for (const h of manifest.hymns) {
    const c = h.capabilities;
    if (c.wordFollowing) assert.equal(c.lineFollowing, true);
    if (c.lineFollowing) assert.equal(c.scoreValidated, true);
    if (c.recognizable) assert.equal(c.scoreValidated, true);
    if (c.recognitionValidated) assert.equal(c.recognizable, true);
    if (c.scoreValidated) {
      assert.ok(h.music.compositionId, `lofzang ${h.number}`);
      assert.ok(loadComposition(h.music.compositionId!), `compositie van ${h.number}`);
      assert.equal(c.textComplete, true);
    } else {
      assert.equal(h.music.compositionId, null);
      // onzekere muziek wordt afgeschermd: geen resolved hymn, geen compositie
      assert.equal(loadResolvedHymn(h.number), null);
      assert.equal(loadReadableHymn(h.number)!.composition, null);
    }
  }
  assert.equal(manifest.counts.official, 205);
});

test("gevalideerde composities: maten stijgen, noten liggen binnen de cyclus, secties sluiten aan en beats van tekst vallen in de muziek", () => {
  for (const h of manifest.hymns.filter((x) => x.capabilities.scoreValidated)) {
    const r = loadResolvedHymn(h.number)!;
    const c = r.composition;
    assert.ok(c.notes.length > 20, `lofzang ${h.number}: noten`);
    for (let i = 1; i < c.measureStarts.length; i += 1) assert.ok(c.measureStarts[i] > c.measureStarts[i - 1]);
    for (const [t, d, midi] of c.notes) {
      assert.ok(t >= 0 && t < c.totalBeats && d > 0 && t + d <= c.totalBeats + 1e-6, `lofzang ${h.number}: noot buiten cyclus`);
      assert.ok(midi >= 24 && midi <= 100);
    }
    assert.equal(c.sections[0].startBeat, 0);
    assert.equal(c.sections[c.sections.length - 1].endBeat, c.totalBeats);
    const firstLines = r.text.stanzas[0].lines;
    assert.ok(firstLines.every((l) => l.startBeat !== null), `lofzang ${h.number}: regelstart couplet 1`);
    for (let i = 1; i < firstLines.length; i += 1) assert.ok(firstLines[i].startBeat! >= firstLines[i - 1].startBeat!);
    for (const st of r.text.stanzas) {
      const beats = st.lines.flatMap((l) => l.words.map((w) => w.b)).filter((b): b is number => b !== null);
      assert.ok(beats.every((b) => b >= 0 && b <= c.totalBeats));
      if (st.linking === "word") assert.ok(st.lines.every((l) => l.words.every((w) => w.b !== null)), `lofzang ${h.number}: woordkoppeling onvolledig`);
    }
  }
});

test("gedeelde melodieën: composities met gelijke noten delen één compositie, met elk hun eigen tekst en nummer", () => {
  const bundle = loadRecognitionBundle();
  const ids = bundle.members.map((m) => m.compositionId);
  assert.equal(new Set(ids).size, bundle.compositions.length);
  const shared = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  assert.ok(shared.length >= 1, "verwacht minstens één gedeelde melodie");
  const candidates = candidatesFromBundle(bundle);
  assert.equal(candidates.length, bundle.compositions.length);
  for (const id of shared) {
    const cand = candidates.find((c) => c.id === id)!;
    const members = bundle.members.filter((m) => m.compositionId === id);
    assert.equal(cand.sharedWith!.length, members.length - 1);
    // de teksten blijven verschillend en bij hun eigen nummer
    const texts = members.map((m) => loadText(m.number)!.text.stanzas[0].lines[0].text);
    assert.equal(new Set(texts).size, members.length);
  }
  // de herkenningsbundel bevat uitsluitend herkenbare (gevalideerde) lofzangen
  for (const m of bundle.members) assert.equal(manifest.hymns.find((h) => h.number === m.number)!.capabilities.recognizable, true);
});

test("zoeken: nummer, volledige titel, deel van de titel, beginwoorden en hoofdletters/accenten", () => {
  const index = prepareIndex(listIndex());
  assert.equal(searchHymns(index, "24")[0].number, 24);
  assert.deepEqual(searchHymns(index, "205").map((h) => h.number).slice(0, 1), [205]);
  assert.equal(searchHymns(index, "ere de man")[0].number, 24);
  assert.equal(searchHymns(index, "ERE DE MAN")[0].number, 24);
  assert.ok(searchHymns(index, "ere")[0].title.toLowerCase().includes("ere"));
  assert.ok(searchHymns(index, "man").some((h) => h.number === 24));
  const first = loadText(36)!.text.stanzas[0].lines[0].text.split(" ").slice(0, 2).join(" ");
  assert.ok(searchHymns(index, first).some((h) => h.number === 36));
  assert.equal(searchHymns(index, "xyzqq").length, 0);
  assert.equal(searchHymns(index, "").length, 205);
  // de lijst verwijst naar alle 205, ook zonder tekst of muziek
  assert.equal(listIndex().length, 205);
  assert.equal(listIndex().find((h) => h.number === 54)!.textAvailable, false);
});

test("het manifest is machineleesbaar en consistent met de bestanden", () => {
  const c = manifest.counts as Record<string, unknown>;
  assert.equal(c.official, 205);
  assert.equal(c.textComplete, 203);
  assert.deepEqual(c.textUnavailable, [54, 151]);
  assert.equal(c.scoreValidated, manifest.hymns.filter((h) => h.capabilities.scoreValidated).length);
  assert.equal(c.recognizable, manifest.hymns.filter((h) => h.capabilities.recognizable).length);
  assert.equal(c.wordFollowing, manifest.hymns.filter((h) => h.capabilities.wordFollowing).length);
  assert.match(manifest.dataVersion, /^[0-9a-f]{12}$/);
});
