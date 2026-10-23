import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next.js 16 gebruikt de flat-config API rechtstreeks via ESLint.
// De officiële Next-configuraties behouden hier de bestaande React-,
// toegankelijkheids- en Next-regels zonder een tweede lokale regelsset.
const config = [
  // Gegenereerde lokale native bundle; de bronbestanden blijven volledig gecontroleerd.
  { ignores: ["dist/native/**", "ios/App/App/public/**", "android/app/src/main/assets/public/**"] },
  ...nextVitals,
  ...nextTypescript,
  {
    // De Next-configuratie registreert de react-hooks-plugin alleen voor deze extensies; een regelblok zonder
    // files-filter faalt anders op CommonJS-bestanden zoals scripts/native/profiles.cjs.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
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
  {
    // De profielmodule is bewust CommonJS (de Capacitor-CLI evalueert capacitor.config.ts als CJS).
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default config;
