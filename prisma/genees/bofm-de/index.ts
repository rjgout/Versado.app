import type { GeneesBankSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { BOM_DE_COLLECTION_ID } from "../../../src/lib/contentCollections";
import { nephi1 } from "./1-ne";
import { nephi2 } from "./2-ne";
import { jakob } from "./jakob";
import { kleineBoeken } from "./kleine-boeken";
import { mosiah } from "./mosiah";
import { alma } from "./alma";
import { helaman } from "./helaman";
import { nephi3 } from "./3-ne";
import { slot } from "./slot";

// Das Buch Mormon, deutsche Ausgabe. Eine Datei pro Buch; gleiche Frage-IDs und Versangaben wie die niederländische Vorlage.
export const bofmDe: GeneesBankSeed = {
  id: "bofm-de",
  work: "bofm",
  collectionId: BOM_DE_COLLECTION_ID,
  chapters: [...nephi1, ...nephi2, ...jakob, ...kleineBoeken, ...mosiah, ...alma, ...helaman, ...nephi3, ...slot],
};
