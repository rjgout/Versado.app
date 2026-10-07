import type { GeneesChapterSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { ch, q } from "../helpers";

// Énos, Jarom, Omni et Paroles de Mormon (édition française). Chaque fait est lié aux versets indiqués dans `verses` ; `npm run genees:check` le vérifie.
export const kleineBoeken: GeneesChapterSeed[] = [
  ch("enos", 1,
    q("a", "3", "Pourquoi Énos alla-t-il dans les forêts ?", "Pour chasser des bêtes", ["Pour puiser de l’eau", "Pour garder ses troupeaux"], ["chasser des bêtes"]),
    q("b", "5", "Qu’entendit Énos après avoir prié tout le jour ?", "Que ses péchés lui étaient pardonnés", ["Que son peuple serait sauvé", "Qu’il devait aller à Jérusalem"], ["pardonnés"]),
    q("c", "25", "Combien d’années s’étaient écoulées depuis que Léhi avait quitté Jérusalem quand Énos devint vieux ?", "Cent soixante-dix-neuf ans", ["Cent trente-sept ans", "Cent quatre-vingt-dix-huit ans"], ["cent soixante-dix-neuf ans"]),
  ),
  ch("jarom", 1,
    q("a", "1", "Selon le commandement de qui Jarom écrivit-il ses paroles ?", "De son père Énos", ["De son frère Jacob", "Du roi Benjamin"], ["Énos"]),
    q("b", "15", "À qui Jarom remit-il les plaques ?", "À son fils Omni", ["À son fils Chémish", "À son frère Énos"], ["Omni"]),
    q("c", "13", "Combien d’années s’étaient écoulées quand Jarom cessa d’écrire ?", "Deux cent trente-huit ans", ["Deux cent vingt-huit ans", "Trois cent trente-huit ans"], ["deux cent trente-huit ans"]),
  ),
  ch("omni", 1,
    q("a", "4,8", "Qui remit les plaques à son frère Chémish ?", "Amaron", ["Amaléki", "Jarom"], ["Amaron"]),
    q("b", "12", "Quel roi fut averti par le Seigneur de s’enfuir du pays de Néphi ?", "Mosiah", ["Chémish", "Amaron"], ["Mosiah"]),
    q("c", "20", "Qu’est-ce qui fut apporté à Mosiah, portant des inscriptions gravées ?", "Une grande pierre", ["Une plaque d’or", "Un rouleau de cuivre"], ["grande pierre"]),
  ),
  ch("w-of-m", 1,
    q("a", "1", "À qui Mormon remet-il les annales qu’il a faites ?", "À son fils Moroni", ["À son fils Hélaman", "Au roi Benjamin"], ["Moroni"]),
    q("b", "3", "Jusqu’au règne de quel roi Mormon avait-il fait un abrégé des plaques de Néphi ?", "Jusqu’au roi Benjamin", ["Jusqu’au roi Noé", "Jusqu’au roi Zénif"], ["Benjamin"]),
    q("c", "17", "Comment le roi Benjamin régnait-il sur son peuple ?", "En justice, comme un saint homme", ["Avec des lois dures, en guerrier", "Avec de grandes richesses, en marchand"], ["justice"]),
  ),
  // ===== EINDE =====
];
