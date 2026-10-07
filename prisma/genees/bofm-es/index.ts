import type { GeneesBankSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { BOM_ES_COLLECTION_ID } from "../../../src/lib/contentCollections";
import { nephi1 } from "./1-ne";
import { nephi2 } from "./2-ne";
import { jakob } from "./jakob";
import { kleineBoeken } from "./kleine-boeken";
import { mosiah } from "./mosiah";
import { alma } from "./alma";
import { helaman } from "./helaman";
import { nephi3 } from "./3-ne";
import { slot } from "./slot";

// Book of Mormon, Spanish edition. Generated from Dutch master.
export const bofmEs: GeneesBankSeed = {
  id: "bofm-es",
  work: "bofm",
  collectionId: BOM_ES_COLLECTION_ID,
  chapters: [...nephi1, ...nephi2, ...jakob, ...kleineBoeken, ...mosiah, ...alma, ...helaman, ...nephi3, ...slot],
};
