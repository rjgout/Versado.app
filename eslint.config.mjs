import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next.js 16 gebruikt de flat-config API rechtstreeks via ESLint.
// De officiële Next-configuraties behouden hier de bestaande React-,
// toegankelijkheids- en Next-regels zonder een tweede lokale regelsset.
const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Deze React-compilerregels zijn strenger dan de bestaande Versado-
      // componentarchitectuur. Ze blijven zichtbaar als waarschuwing totdat
      // de betrokken stateful flows gericht kunnen worden gemigreerd; een
      // automatische fix zou hier functioneel gedrag kunnen veranderen.
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
];

export default config;
