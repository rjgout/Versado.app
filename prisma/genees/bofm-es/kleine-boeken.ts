import type { GeneesChapterSeed } from "../../../src/lib/snelleZendeling/reviveBank";
import { ch, q } from "../helpers";

// Enós, Jarom, Omni y Palabras de Mormón (edición en español). Cada hecho está ligado a los versículos indicados en `verses`; `npm run genees:check` lo verifica.
export const kleineBoeken: GeneesChapterSeed[] = [
  ch("enos", 1,
    q("a", "3", "¿A qué salió Enós cuando las palabras de su padre penetraron profundamente en su corazón?", "A cazar bestias en los bosques", ["A traer agua del río", "A cuidar sus rebaños en el valle"], ["cazar bestias"]),
    q("b", "5", "¿Qué oyó Enós después de orar todo el día?", "Que sus pecados le eran perdonados", ["Que su pueblo sería salvo de sus enemigos", "Que debía regresar a Jerusalén ahora"], ["perdonados"]),
    q("c", "25", "¿Cuántos años habían transcurrido desde que Lehi salió de Jerusalén cuando Enós envejeció?", "Ciento setenta y nueve años", ["Ciento treinta y siete años", "Ciento noventa y ocho años"], ["ciento setenta y nueve"]),
  ),
  ch("jarom", 1,
    q("a", "1", "¿De quién era el mandato que siguió Jarom al escribir sus palabras?", "El de su padre Enós", ["El de su hermano Jacob", "El del rey Benjamín"], ["Enós"]),
    q("b", "15", "¿A quién entregó Jarom las planchas?", "A su hijo Omni", ["A su hijo Quemis", "A su hermano Enós"], ["Omni"]),
    q("c", "13", "¿Cuántos años habían transcurrido cuando Jarom dejó de escribir?", "Doscientos treinta y ocho años", ["Doscientos veintiocho años", "Trescientos treinta y ocho años"], ["doscientos treinta y ocho"]),
  ),
  ch("omni", 1,
    q("a", "4,8", "¿Quién entregó las planchas a su hermano Quemis?", "Amarón", ["Amalekí", "Abinadom"], ["Amarón"]),
    q("b", "12", "¿Qué rey fue advertido por el Señor de que huyera de la tierra de Nefi?", "Mosíah", ["Quemis", "Abinadom"], ["Mosíah"]),
    q("c", "20", "¿Qué se le trajo a Mosíah, con grabados?", "Una piedra grande", ["Una plancha de oro", "Un rollo de cobre"], ["piedra grande"]),
  ),
  ch("w-of-m", 1,
    q("a", "1", "¿A quién entrega Mormón los anales que ha hecho?", "A su hijo Moroni", ["A su hijo Helamán", "Al rey Benjamín"], ["Moroni"]),
    q("b", "3", "¿Hasta el reinado de qué rey había hecho Mormón un compendio de las planchas de Nefi?", "Hasta el rey Benjamín", ["Hasta el rey Noé", "Hasta el rey Zeniff"], ["Benjamín"]),
    q("c", "17", "¿Cómo reinaba el rey Benjamín sobre su pueblo?", "Con justicia, como un hombre santo", ["Con leyes severas, como un guerrero", "Con gran riqueza, como un mercader"], ["con justicia"]),
  ),
  // ===== EINDE =====
];
