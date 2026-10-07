import type { GeneesChapterSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { ch, q } from "../helpers";

// Enos, Jarom, Omni und die Worte Mormons (deutsche Ausgabe). Jede Tatsache ist an die Verse in `verses` gebunden; `npm run genees:check` prüft das.
export const kleineBoeken: GeneesChapterSeed[] = [
  ch("enos", 1,
    q("a", "3", "Wozu ging Enos in die Wälder?", "Um wilde Tiere zu jagen", ["Um Wasser vom Fluss zu holen", "Um die Herden im Tal zu hüten"], ["wilde Tiere zu jagen"]),
    q("b", "5", "Was hörte Enos, nachdem er den ganzen Tag gebetet hatte?", "Dass seine Sünden ihm vergeben waren", ["Dass sein Volk errettet werden würde", "Dass er nach Jerusalem gehen sollte"], ["vergeben"]),
    q("c", "25", "Wie viele Jahre waren vergangen, seit Lehi Jerusalem verlassen hatte, als Enos alt wurde?", "Einhundertneunundsiebzig Jahre", ["Einhundertsiebenunddreißig Jahre", "Einhundertachtundneunzig Jahre"], ["einhundertneunundsiebzig"]),
  ),
  ch("jarom", 1,
    q("a", "1", "Wessen Gebot befolgte Jarom beim Schreiben seiner Worte?", "Das Gebot seines Vaters Enos", ["Das Gebot seines Bruders Jakob", "Das Gebot König Benjamins"], ["Enos"]),
    q("b", "15", "Wem übergab Jarom die Platten?", "Seinem Sohn Omni", ["Seinem Sohn Kemisch", "Seinem Bruder Enos"], ["Omni"]),
    q("c", "13", "Wie viele Jahre waren vergangen, als Jarom aufhörte zu schreiben?", "Zweihundertachtunddreißig Jahre", ["Zweihundertachtundzwanzig Jahre", "Dreihundertachtunddreißig Jahre"], ["Zweihundertachtunddreißig"]),
  ),
  ch("omni", 1,
    q("a", "4,8", "Wer übergab die Platten seinem Bruder Kemisch?", "Amaron", ["Amaleki", "Abinadom"], ["Amaron"]),
    q("b", "12", "Welcher König wurde vom Herrn gewarnt, aus dem Land Nephi zu fliehen?", "Mosia", ["Amaron", "Jarom"], ["Mosia"]),
    q("c", "20", "Was wurde ihm in den Tagen Mosias gebracht, mit Gravierungen darauf?", "Ein großer Stein", ["Eine goldene Platte", "Eine kupferne Rolle"], ["großer Stein"]),
  ),
  ch("w-of-m", 1,
    q("a", "1", "Wem übergibt Mormon den Bericht, den er angefertigt hat?", "Seinem Sohn Moroni", ["Seinem Sohn Helaman", "König Benjamin"], ["Moroni"]),
    q("b", "3", "Bis zur Regierung welches Königs hatte Mormon einen Auszug aus den Platten Nephis gemacht?", "Bis zur Regierung König Benjamins", ["Bis zur Regierung König Noahs", "Bis zur Regierung König Zeniffs"], ["Benjamin"]),
    q("c", "17", "Wie regierte König Benjamin sein Volk?", "In Rechtschaffenheit, als heiliger Mann", ["Mit strengen Gesetzen, als Krieger", "Mit großem Reichtum, als Händler"], ["Rechtschaffenheit"]),
  ),
  // ===== EINDE =====
];
