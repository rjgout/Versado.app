import type { GeneesBankSeed } from "../../src/lib/snelleZendeling/reviveBank";
import { bofmNl } from "./bofm-nl";

/** Alle gecureerde Genees-vragenbanken, één per uitgave. Zie docs/SNELLE-ZENDELING.md. */
export const GENEES_BANKS: GeneesBankSeed[] = [bofmNl];
