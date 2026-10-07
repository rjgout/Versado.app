import type { GeneesBankSeed } from "../../src/lib/snelleZendeling/reviveBank";
import { bofmNl } from "./bofm-nl";
import { bofmEn } from "./bofm-en";
import { bofmDe } from "./bofm-de";
import { bofmFr } from "./bofm-fr";
import { bofmEs } from "./bofm-es";

/** All curated Genees question banks, one per edition. See docs/SNELLE-ZENDELING.md. */
export const GENEES_BANKS: GeneesBankSeed[] = [bofmNl, bofmEn, bofmDe, bofmFr, bofmEs];
