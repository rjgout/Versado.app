/**
 * Profielcamera-gegevens uit docs/scripture/profile-character-framing.json.
 * De voet- en Mysterieankers zijn niet uitwisselbaar; dit bestand wordt alleen
 * door de vaste profielheader gebruikt.
 */
export interface ProfileCharacterFrame {
  readonly source: readonly [number, number];
  readonly visible: readonly [number, number, number, number];
  readonly foot: readonly [number, number];
  readonly head: readonly [number, number];
  readonly zoom: number;
}

export const PROFILE_CHARACTER_FRAMING = {
  "aaron": { source: [1024, 1536], visible: [204, 19, 802, 1507], foot: [503, 1507], head: [486, 182], zoom: 2.45 },
  "abinadi": { source: [1024, 1536], visible: [238, 37, 755, 1503], foot: [496, 1503], head: [501, 198], zoom: 2.45 },
  "abish": { source: [1024, 1536], visible: [281, 15, 738, 1513], foot: [509, 1513], head: [483, 179], zoom: 2.45 },
  "alma-elder": { source: [1024, 1536], visible: [243, 46, 779, 1504], foot: [511, 1504], head: [512, 206], zoom: 2.45 },
  "alma-younger": { source: [1024, 1536], visible: [195, 24, 787, 1506], foot: [491, 1506], head: [500, 187], zoom: 2.45 },
  "amalickiah": { source: [1024, 1536], visible: [234, 19, 827, 1494], foot: [530, 1494], head: [482, 181], zoom: 2.45 },
  "amlici": { source: [1024, 1536], visible: [229, 17, 823, 1491], foot: [526, 1491], head: [484, 179], zoom: 2.45 },
  "ammaron": { source: [1024, 1536], visible: [270, 7, 732, 1524], foot: [501, 1524], head: [478, 173], zoom: 2.45 },
  "ammon-expedition": { source: [1024, 1536], visible: [214, 31, 781, 1480], foot: [497, 1480], head: [480, 190], zoom: 2.45 },
  "ammon-missionary": { source: [1024, 1536], visible: [185, 16, 814, 1503], foot: [499, 1503], head: [487, 179], zoom: 2.45 },
  "amulek": { source: [1024, 1536], visible: [238, 22, 803, 1486], foot: [520, 1486], head: [504, 183], zoom: 2.45 },
  "amulon": { source: [1024, 1536], visible: [196, 7, 826, 1505], foot: [511, 1505], head: [459, 171], zoom: 2.45 },
  "angel-alma": { source: [1024, 1536], visible: [232, 18, 747, 1491], foot: [489, 1491], head: [472, 180], zoom: 2.45 },
  "brother-of-jared": { source: [1024, 1536], visible: [251, 7, 774, 1522], foot: [512, 1522], head: [487, 173], zoom: 2.45 },
  "captain-moroni": { source: [1024, 1536], visible: [195, 15, 939, 1509], foot: [567, 1509], head: [471, 179], zoom: 2.45 },
  "church-disciple": { source: [1024, 1536], visible: [253, 10, 733, 1523], foot: [493, 1523], head: [478, 176], zoom: 2.45 },
  "corianton": { source: [1024, 1536], visible: [199, 30, 804, 1508], foot: [501, 1508], head: [490, 192], zoom: 2.45 },
  "coriantumr": { source: [1024, 1536], visible: [197, 25, 782, 1475], foot: [489, 1475], head: [480, 184], zoom: 2.45 },
  "enos": { source: [1024, 1536], visible: [219, 8, 753, 1519], foot: [486, 1519], head: [470, 174], zoom: 2.45 },
  "ether": { source: [1024, 1536], visible: [243, 34, 759, 1504], foot: [501, 1504], head: [496, 195], zoom: 2.45 },
  "gideon": { source: [1024, 1536], visible: [216, 19, 777, 1503], foot: [496, 1503], head: [465, 182], zoom: 2.45 },
  "hagoth": { source: [1024, 1536], visible: [203, 13, 838, 1496], foot: [520, 1496], head: [490, 176], zoom: 2.45 },
  "heavenly-father": { source: [1024, 1536], visible: [196, 23, 745, 1485], foot: [470, 1485], head: [458, 183], zoom: 2.45 },
  "helam": { source: [1024, 1536], visible: [228, 19, 774, 1502], foot: [501, 1502], head: [478, 182], zoom: 2.45 },
  "helaman-son-alma": { source: [1024, 1536], visible: [194, 24, 793, 1508], foot: [493, 1508], head: [506, 187], zoom: 2.45 },
  "helaman-son-helaman": { source: [1024, 1536], visible: [235, 14, 815, 1512], foot: [525, 1512], head: [502, 178], zoom: 2.45 },
  "himni": { source: [1024, 1536], visible: [194, 17, 803, 1502], foot: [498, 1502], head: [492, 180], zoom: 2.45 },
  "ismael": { source: [1254, 1254], visible: [404, 117, 781, 1145], foot: [592, 1145], head: [593, 230], zoom: 2.45 },
  "ismael-wife": { source: [1024, 1536], visible: [257, 17, 769, 1515], foot: [513, 1515], head: [484, 181], zoom: 2.45 },
  "jacob-son-lehi": { source: [1024, 1536], visible: [216, 26, 765, 1524], foot: [490, 1524], head: [493, 190], zoom: 2.45 },
  "jared": { source: [1024, 1536], visible: [160, 13, 849, 1521], foot: [504, 1521], head: [448, 178], zoom: 2.45 },
  "jaredite-king-role": { source: [1024, 1536], visible: [196, 9, 868, 1523], foot: [532, 1523], head: [532, 175], zoom: 2.45 },
  "jaredite-prophet-role": { source: [1024, 1536], visible: [212, 10, 745, 1520], foot: [478, 1520], head: [462, 176], zoom: 2.45 },
  "jesus-christ": { source: [1024, 1536], visible: [223, 38, 722, 1477], foot: [472, 1477], head: [458, 196], zoom: 2.45 },
  "joseph-smith": { source: [1024, 1536], visible: [277, 29, 777, 1440], foot: [527, 1440], head: [475, 184], zoom: 2.45 },
  "joseph-son-lehi": { source: [1024, 1536], visible: [251, 40, 783, 1499], foot: [517, 1499], head: [517, 200], zoom: 2.45 },
  "king-benjamin": { source: [1024, 1536], visible: [243, 33, 780, 1507], foot: [511, 1507], head: [492, 195], zoom: 2.45 },
  "king-laman": { source: [1024, 1536], visible: [208, 32, 867, 1492], foot: [537, 1492], head: [452, 192], zoom: 2.45 },
  "king-limhi": { source: [1024, 1536], visible: [205, 12, 819, 1492], foot: [512, 1492], head: [476, 174], zoom: 2.45 },
  "king-noah": { source: [1024, 1536], visible: [194, 35, 819, 1488], foot: [506, 1488], head: [462, 194], zoom: 2.45 },
  "korihor": { source: [1024, 1536], visible: [245, 21, 793, 1496], foot: [519, 1496], head: [488, 183], zoom: 2.45 },
  "laban": { source: [1254, 1254], visible: [413, 134, 822, 1144], foot: [617, 1144], head: [622, 245], zoom: 2.45 },
  "laman": { source: [1254, 1254], visible: [412, 102, 802, 1138], foot: [607, 1138], head: [620, 215], zoom: 2.45 },
  "lamoni": { source: [1024, 1536], visible: [201, 22, 896, 1492], foot: [548, 1492], head: [469, 183], zoom: 2.45 },
  "lamoni-father": { source: [1024, 1536], visible: [215, 27, 829, 1493], foot: [522, 1493], head: [456, 188], zoom: 2.45 },
  "lamoni-father-wife": { source: [1024, 1536], visible: [260, 23, 742, 1513], foot: [501, 1513], head: [498, 186], zoom: 2.45 },
  "lamoni-wife": { source: [1024, 1536], visible: [220, 19, 765, 1516], foot: [492, 1516], head: [497, 183], zoom: 2.45 },
  "lehi": { source: [1254, 1254], visible: [398, 104, 797, 1140], foot: [597, 1140], head: [616, 217], zoom: 2.45 },
  "lehi-dream-guide": { source: [1024, 1536], visible: [234, 26, 741, 1486], foot: [487, 1486], head: [458, 186], zoom: 2.45 },
  "lehi-son-helaman": { source: [1024, 1536], visible: [228, 13, 827, 1512], foot: [527, 1512], head: [493, 177], zoom: 2.45 },
  "lemuel": { source: [1254, 1254], visible: [429, 110, 791, 1142], foot: [610, 1142], head: [630, 223], zoom: 2.45 },
  "mormon": { source: [1024, 1536], visible: [229, 22, 775, 1516], foot: [502, 1516], head: [486, 186], zoom: 2.45 },
  "moroni-son-mormon": { source: [1024, 1536], visible: [274, 8, 752, 1509], foot: [513, 1509], head: [490, 173], zoom: 2.45 },
  "mosiah-son-benjamin": { source: [1024, 1536], visible: [203, 19, 794, 1502], foot: [498, 1502], head: [502, 182], zoom: 2.45 },
  "nehor": { source: [1024, 1536], visible: [184, 16, 851, 1499], foot: [517, 1499], head: [457, 179], zoom: 2.45 },
  "nephi": { source: [1254, 1254], visible: [427, 102, 815, 1148], foot: [621, 1148], head: [632, 217], zoom: 2.45 },
  "nephi-son-helaman": { source: [1024, 1536], visible: [231, 15, 812, 1511], foot: [521, 1511], head: [496, 179], zoom: 2.45 },
  "nephi-son-nephi": { source: [1024, 1536], visible: [232, 9, 776, 1516], foot: [504, 1516], head: [460, 174], zoom: 2.45 },
  "nephi-wife": { source: [1024, 1536], visible: [242, 44, 716, 1487], foot: [479, 1487], head: [472, 202], zoom: 2.45 },
  "nephihah": { source: [1024, 1536], visible: [230, 25, 810, 1506], foot: [520, 1506], head: [509, 187], zoom: 2.45 },
  "omner": { source: [1024, 1536], visible: [189, 9, 801, 1502], foot: [495, 1502], head: [493, 173], zoom: 2.45 },
  "pahoran": { source: [1024, 1536], visible: [233, 12, 808, 1508], foot: [520, 1508], head: [502, 176], zoom: 2.45 },
  "sam": { source: [1254, 1254], visible: [434, 119, 799, 1103], foot: [616, 1103], head: [636, 227], zoom: 2.45 },
  "samuel-lamanite": { source: [1024, 1536], visible: [235, 10, 744, 1507], foot: [489, 1507], head: [472, 174], zoom: 2.45 },
  "sariah": { source: [1254, 1254], visible: [391, 106, 769, 1148], foot: [580, 1148], head: [576, 220], zoom: 2.45 },
  "sherem": { source: [1024, 1536], visible: [247, 26, 793, 1497], foot: [520, 1497], head: [493, 187], zoom: 2.45 },
  "shiblon": { source: [1024, 1536], visible: [179, 22, 798, 1509], foot: [488, 1509], head: [477, 185], zoom: 2.45 },
  "shiz": { source: [1024, 1536], visible: [194, 35, 789, 1481], foot: [491, 1481], head: [492, 194], zoom: 2.45 },
  "zeezrom": { source: [1024, 1536], visible: [262, 16, 761, 1463], foot: [511, 1463], head: [491, 175], zoom: 2.45 },
  "zeniff": { source: [1024, 1536], visible: [215, 27, 788, 1503], foot: [501, 1503], head: [484, 189], zoom: 2.45 },
  "zerahemnah": { source: [1024, 1536], visible: [226, 25, 888, 1507], foot: [557, 1507], head: [481, 188], zoom: 2.45 },
  "zoram": { source: [1254, 1254], visible: [405, 114, 792, 1143], foot: [598, 1143], head: [612, 227], zoom: 2.45 },
  "zoramite-worshipper": { source: [1024, 1536], visible: [240, 19, 798, 1506], foot: [519, 1506], head: [508, 182], zoom: 2.45 },
} as const satisfies Record<string, ProfileCharacterFrame>;

export function profileFrameFor(id: string): ProfileCharacterFrame | null {
  return PROFILE_CHARACTER_FRAMING[id as keyof typeof PROFILE_CHARACTER_FRAMING] ?? null;
}
