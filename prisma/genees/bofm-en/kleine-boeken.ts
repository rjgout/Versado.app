import type { GeneesChapterSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { ch, q } from "../helpers";

// Enos, Jarom, Omni and the Words of Mormon (English edition). Each fact is tied to the verses in `verses`; `npm run genees:check` verifies that.
export const kleineBoeken: GeneesChapterSeed[] = [
  ch("enos", 1,
    q("a", "3", "What did Enos go out to do when his father's words sank deep into his heart?", "Hunt beasts in the forests", ["Fetch water from the river", "Tend his flocks in the valley"], ["hunt beasts"]),
    q("b", "5", "What did Enos hear after praying all day?", "That his sins were forgiven him", ["That his people would be saved", "That he must go to Jerusalem"], ["forgiven"]),
    q("c", "25", "How many years had passed since Lehi left Jerusalem when Enos grew old?", "One hundred and seventy-nine years", ["One hundred and thirty-seven years", "One hundred and ninety-eight years"], ["hundred and seventy"]),
  ),
  ch("jarom", 1,
    q("a", "1", "Whose commandment did Jarom follow in writing his words?", "That of his father Enos", ["That of his brother Jacob", "That of King Benjamin"], ["Enos"]),
    q("b", "15", "To whom did Jarom deliver the plates?", "To his son Omni", ["To his son Chemish", "To his brother Enos"], ["Omni"]),
    q("c", "13", "How many years had passed when Jarom stopped writing?", "Two hundred and thirty-eight years", ["Two hundred and twenty-eight years", "Three hundred and thirty-eight years"], ["two hundred and thirty"]),
  ),
  ch("omni", 1,
    q("a", "4,8", "Who delivered the plates to his brother Chemish?", "Amaron", ["Amaleki", "Abinadom"], ["Amaron"]),
    q("b", "12", "Which king was warned by the Lord to flee out of the land of Nephi?", "Mosiah", ["Chemish", "Abinadom"], ["Mosiah"]),
    q("c", "20", "What was brought to Mosiah, with engravings on it?", "A large stone", ["A golden plate", "A copper scroll"], ["large stone"]),
  ),
  ch("w-of-m", 1,
    q("a", "1", "To whom does Mormon deliver the record he has been making?", "To his son Moroni", ["To his son Helaman", "To King Benjamin"], ["Moroni"]),
    q("b", "3", "Down to the reign of which king had Mormon made an abridgment of the plates of Nephi?", "To King Benjamin", ["To King Noah", "To King Zeniff"], ["Benjamin"]),
    q("c", "17", "How did King Benjamin reign over his people?", "In righteousness, as a holy man", ["With strict laws, as a warrior", "With great wealth, as a merchant"], ["righteousness"]),
  ),
  // ===== EINDE =====
];
