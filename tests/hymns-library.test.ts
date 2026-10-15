import assert from "node:assert/strict";
import test from "node:test";
import { POC_LIBRARY, listHymns, resolveHymn } from "../src/lib/hymns/library";
import { buildReference } from "../src/lib/hymns/score/reference";

// Gegevensintegriteit van de proefbibliotheek (nld-poc.json), afgeleid van de officiële PDF's en pagina's.
// De bron staat in scripts/hymns; hier wordt bewaakt dat de afgeleide gegevens in zichzelf kloppen.

test("de uitgave verwijst naar de drie proeflofzangen met het officiële Nederlandse nummer", () => {
  const entries = POC_LIBRARY.edition.entries.map((e) => [e.number, resolveHymn(POC_LIBRARY, e.number)?.text.title]);
  assert.deepEqual(entries, [
    [24, "Ere de man"],
    [36, "Kom, o Gij Vredevorst"],
    [82, "Kom, volg Mij na"],
  ]);
  assert.equal(POC_LIBRARY.edition.language, "nld");
});

test("compositie, tekst, uitgave en nummer zijn gescheiden lagen met eigen id's", () => {
  for (const h of listHymns(POC_LIBRARY)) {
    assert.notEqual(h.composition.id, h.text.id);
    assert.equal(h.text.compositionId, h.composition.id);
    assert.match(h.composition.id, /^comp:/);
    assert.match(h.text.id, /^nld:/);
    // het nummer hoort bij de uitgave, niet bij compositie of tekst
    assert.equal("number" in h.composition, false);
    assert.equal("number" in h.text, false);
    // de compositie is taalonafhankelijk
    assert.equal("language" in h.composition, false);
  }
});

test("elke compositie heeft sluitende maten: de beats van de maten tellen op tot de totaallengte", () => {
  for (const h of listHymns(POC_LIBRARY)) {
    const c = h.composition;
    assert.ok(c.notes.length > 100, `${h.number}: te weinig noten`);
    assert.equal(c.measureStarts[0], 0);
    for (let i = 1; i < c.measureStarts.length; i += 1) assert.ok(c.measureStarts[i] > c.measureStarts[i - 1]);
    for (const [t, dur, midi, staff] of c.notes) {
      assert.ok(t >= 0 && t + dur <= c.totalBeats + 1e-6, `${h.number}: noot buiten de cyclus`);
      assert.ok(midi >= 36 && midi <= 84, `${h.number}: midi ${midi} onwaarschijnlijk`);
      assert.ok(staff === 0 || staff === 1);
    }
    // alle maten behalve de eerste (opmaat) zijn een volle maat
    for (let i = 1; i < c.measureStarts.length - 1; i += 1) {
      assert.ok(Math.abs(c.measureStarts[i + 1] - c.measureStarts[i] - c.beatsPerBar) < 1e-6, `${h.number}: maat ${i + 1} is geen volle maat`);
    }
  }
});

test("secties: lofzang 24 heeft couplet en refrein, 36 en 82 alleen een couplet", () => {
  const sections = (n: number) => resolveHymn(POC_LIBRARY, n)!.composition.sections.map((s) => s.id);
  assert.deepEqual(sections(24), ["verse", "chorus"]);
  assert.deepEqual(sections(36), ["verse"]);
  assert.deepEqual(sections(82), ["verse"]);
  for (const h of listHymns(POC_LIBRARY)) {
    const s = h.composition.sections;
    assert.equal(s[0].startBeat, 0);
    assert.ok(Math.abs(s[s.length - 1].endBeat - h.composition.totalBeats) < 1e-6);
    assert.equal(Boolean(h.text.chorus), s.length === 2);
  }
});

test("tekst: aantal coupletten en regels klopt met de officiële pagina", () => {
  const counts = (n: number) => resolveHymn(POC_LIBRARY, n)!.text.stanzas.map((s) => s.lines.length);
  assert.deepEqual(counts(24), [4, 4, 4, 4]);
  assert.deepEqual(counts(36), [6, 6, 6, 6]);
  assert.deepEqual(counts(82), [4, 4, 4, 4, 4, 4]);
  assert.equal(resolveHymn(POC_LIBRARY, 24)!.text.chorus!.lines.length, 4);
  assert.equal(resolveHymn(POC_LIBRARY, 24)!.text.stanzas[0].lines[0].text, "Ere de man tot wie sprak weer Jehovah,");
});

test("tekst-naar-nootkoppeling: begintijden van regels en woorden stijgen en vallen binnen de partituur", () => {
  for (const h of listHymns(POC_LIBRARY)) {
    const T = h.composition.totalBeats;
    const check = (lines: { startBeat: number | null; words: { b: number | null }[] }[], label: string) => {
      let prev = -1;
      for (const line of lines) {
        assert.notEqual(line.startBeat, null, `${label}: regel zonder startpunt`);
        assert.ok(line.startBeat! > prev, `${label}: regelstarts niet stijgend`);
        assert.ok(line.startBeat! >= 0 && line.startBeat! < T);
        prev = line.startBeat!;
        let pw = -1;
        for (const w of line.words) {
          if (w.b === null) continue;
          assert.ok(w.b >= pw - 1e-9, `${label}: woordstarts niet stijgend`);
          pw = w.b;
        }
      }
    };
    for (const st of h.text.stanzas) check(st.lines, `${h.number} couplet ${st.n}`);
    if (h.text.chorus) check(h.text.chorus.lines, `${h.number} refrein`);
  }
});

test("woordkoppeling: coupletten 1-4 van elke lofzang zijn per woord gekoppeld, coupletten onder de muziek per regel", () => {
  const h82 = resolveHymn(POC_LIBRARY, 82)!;
  assert.deepEqual(h82.text.stanzas.map((s) => s.linking), ["word", "word", "word", "word", "line", "line"]);
  for (const n of [24, 36]) {
    for (const st of resolveHymn(POC_LIBRARY, n)!.text.stanzas) assert.equal(st.linking, "word");
  }
  // in een woordgekoppeld couplet heeft vrijwel elk woord een koppeling
  for (const h of listHymns(POC_LIBRARY)) {
    for (const st of h.text.stanzas.filter((s) => s.linking === "word")) {
      const words = st.lines.flatMap((l) => l.words);
      const linked = words.filter((w) => w.b !== null).length;
      assert.ok(linked / words.length >= 0.9, `${h.number} couplet ${st.n}: slechts ${linked}/${words.length} woorden gekoppeld`);
    }
  }
});

test("referentiekenmerken: elke stap van de cyclus is genormaliseerd of stil, en de cyclus heeft muziek", () => {
  for (const h of listHymns(POC_LIBRARY)) {
    const ref = buildReference(h.composition);
    assert.equal(ref.steps, Math.round(h.composition.totalBeats / ref.stepBeats));
    let silent = 0;
    for (let s = 0; s < ref.steps; s += 1) {
      let norm = 0;
      for (let k = 0; k < ref.dim; k += 1) norm += ref.chroma[s * ref.dim + k] ** 2;
      if (norm === 0) silent += 1;
      else assert.ok(Math.abs(norm - 1) < 1e-3);
    }
    assert.ok(silent / ref.steps < 0.02, `${h.number}: te veel stille stappen in de referentie`);
  }
});
