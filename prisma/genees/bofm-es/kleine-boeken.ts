import type { GeneesChapterSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { ch, q } from "../helpers";

// Enos, Jarom, Omni en de Woorden van Mormon. Elk feit is gebonden aan de verzen in `verses`;
// `npm run genees:check` controleert dat.
export const kleineBoeken: GeneesChapterSeed[] = [
  ch("enos", 1,
    q("a", "3", "Waar ging Enos op uit toen de woorden van zijn vader tot diep in zijn hart doordrongen?", "Op dieren jagen in de wouden", ["Water halen bij de rivier", "Zijn kudden hoeden in het dal"], ["dieren jagen"]),
    q("b", "5", "Wat hoorde Enos nadat hij de hele dag had gebeden?", "Dat zijn zonden hem waren vergeven", ["Dat zijn volk gered zou worden", "Dat hij naar Jeruzalem moest gaan"], ["vergeven"]),
    q("c", "25", "Hoeveel jaar waren er verstreken sinds Lehi Jeruzalem had verlaten toen Enos oud werd?", "Honderdnegenenzeventig jaar", ["Honderdzevenendertig jaar", "Honderdachtennegentig jaar"], ["honderdnegenenzeventig"]),
  ),
  ch("jarom", 1,
    q("a", "1", "Wiens gebod volgde Jarom bij het schrijven van zijn woorden?", "Dat van zijn vader Enos", ["Dat van zijn broer Jakob", "Dat van koning Benjamin"], ["Enos"]),
    q("b", "15", "Aan wie overhandigde Jarom de platen?", "Aan zijn zoon Omni", ["Aan zijn zoon Chemish", "Aan zijn broer Enos"], ["Omni"]),
    q("c", "13", "Hoeveel jaar waren er verstreken toen Jarom ophield met schrijven?", "Tweehonderdachtendertig jaar", ["Tweehonderdachtentwintig jaar", "Driehonderdachtendertig jaar"], ["tweehonderdachtendertig"]),
  ),
  ch("omni", 1,
    q("a", "4,8", "Wie droeg de platen over aan zijn broer Chemish?", "Amaron", ["Amaleki", "Abinadom"], ["Amaron"]),
    q("b", "12", "Welke koning moest op bevel van de Heer uit het land Nephi vluchten?", "Mosiah", ["Chemish", "Abinadom"], ["Mosiah"]),
    q("c", "20", "Wat werd er in de dagen van Mosiah aan hem gebracht, met graveersels erop?", "Een grote steen", ["Een gouden plaat", "Een koperen rol"], ["grote steen"]),
  ),
  ch("w-of-m", 1,
    q("a", "1", "Aan wie overhandigt Mormon de kroniek die hij heeft gemaakt?", "Aan zijn zoon Moroni", ["Aan zijn zoon Helaman", "Aan koning Benjamin"], ["Moroni"]),
    q("b", "3", "Tot aan de regering van welke koning had Mormon een samenvatting van de platen van Nephi gemaakt?", "Tot koning Benjamin", ["Tot koning Noach", "Tot koning Zeniff"], ["Benjamin"]),
    q("c", "17", "Hoe regeerde koning Benjamin over zijn volk?", "In rechtvaardigheid, als een heilig man", ["Met strenge wetten, als een krijger", "Met grote rijkdom, als een handelaar"], ["rechtvaardigheid"]),
  ),
  // ===== EINDE =====
];
