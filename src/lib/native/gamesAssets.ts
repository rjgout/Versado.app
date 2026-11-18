/** Alleen publiek meegeleverde spelmanifesten, zonder API- of netwerkfallback. */
import manifest0 from "../../../public/mysterie-001a-ontdekker/manifest.json";
import manifest1 from "../../../public/mysterie-001b-onderzoeker/manifest.json";
import manifest2 from "../../../public/mysterie-001c-schriftkenner/manifest.json";
import manifest3 from "../../../public/mysterie-002a-ontdekker/manifest.json";
import manifest4 from "../../../public/mysterie-002b-onderzoeker/manifest.json";
import manifest5 from "../../../public/mysterie-002c-schriftkenner/manifest.json";
import manifest6 from "../../../public/mysterie-003a-ontdekker/manifest.json";
import manifest7 from "../../../public/mysterie-003b-onderzoeker/manifest.json";
import manifest8 from "../../../public/mysterie-003c-schriftkenner/manifest.json";
import manifest9 from "../../../public/mysterie-004a-ontdekker/manifest.json";
import manifest10 from "../../../public/mysterie-004b-onderzoeker/manifest.json";
import manifest11 from "../../../public/mysterie-004c-schriftkenner/manifest.json";
import manifest12 from "../../../public/mysterie-005a-ontdekker/manifest.json";
import manifest13 from "../../../public/mysterie-005b-onderzoeker/manifest.json";
import manifest14 from "../../../public/mysterie-005c-schriftkenner/manifest.json";
import manifest15 from "../../../public/mysterie-006a-ontdekker/manifest.json";
import manifest16 from "../../../public/mysterie-006b-onderzoeker/manifest.json";
import manifest17 from "../../../public/mysterie-006c-schriftkenner/manifest.json";
const manifests:Record<string,unknown>={
"/mysterie-001a-ontdekker/manifest.json":manifest0,
"/mysterie-001b-onderzoeker/manifest.json":manifest1,
"/mysterie-001c-schriftkenner/manifest.json":manifest2,
"/mysterie-002a-ontdekker/manifest.json":manifest3,
"/mysterie-002b-onderzoeker/manifest.json":manifest4,
"/mysterie-002c-schriftkenner/manifest.json":manifest5,
"/mysterie-003a-ontdekker/manifest.json":manifest6,
"/mysterie-003b-onderzoeker/manifest.json":manifest7,
"/mysterie-003c-schriftkenner/manifest.json":manifest8,
"/mysterie-004a-ontdekker/manifest.json":manifest9,
"/mysterie-004b-onderzoeker/manifest.json":manifest10,
"/mysterie-004c-schriftkenner/manifest.json":manifest11,
"/mysterie-005a-ontdekker/manifest.json":manifest12,
"/mysterie-005b-onderzoeker/manifest.json":manifest13,
"/mysterie-005c-schriftkenner/manifest.json":manifest14,
"/mysterie-006a-ontdekker/manifest.json":manifest15,
"/mysterie-006b-onderzoeker/manifest.json":manifest16,
"/mysterie-006c-schriftkenner/manifest.json":manifest17,
};
export function packagedGameManifest(path:string){return Object.hasOwn(manifests,path)?manifests[path]:undefined;}
