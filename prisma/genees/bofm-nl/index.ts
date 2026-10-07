import type { GeneesBankSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { BOM_COLLECTION_ID } from "../../../src/lib/contentCollections";
import { nephi1 } from "./1-ne";
import { nephi2 } from "./2-ne";
import { jakob } from "./jakob";
import { kleineBoeken } from "./kleine-boeken";

// Het Boek van Mormon, Nederlandse uitgave. Eén bestand per boek; de volgorde
// hier is niet van belang (Genees volgt Book.order en Chapter.order uit de
// database). Nieuwe varianten alleen achteraan toevoegen met een nieuwe id.
export const bofmNl: GeneesBankSeed = {
  id: "bofm-nl",
  work: "bofm",
  collectionId: BOM_COLLECTION_ID,
  chapters: [...nephi1, ...nephi2, ...jakob, ...kleineBoeken],
};
