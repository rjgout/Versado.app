import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ID, bundleDirectory, capacitorSettings, metadataProblems, resolveBuildProfile, internalAccessEnabled, INTERNAL_ACCESS_FILE } from "./scripts/native/profiles.cjs";

// Alle profielregels (remote-preview, local-development, local-internal, local-store-test en het geblokkeerde
// release-profiel) staan in scripts/native/profiles.cjs: dezelfde module die ook build en verificatie gebruiken.
// Een ongeldig of geblokkeerd profiel gooit hier een fout, zodat `cap sync` nooit met een onveilige configuratie draait.
const resolved = resolveBuildProfile(process.env, { stage: "config" });
const access = internalAccessEnabled(resolved);

if (resolved.kind === "local") {
  const accessPath = join(bundleDirectory(process.env), INTERNAL_ACCESS_FILE);
  if (existsSync(accessPath) !== access || (access && readFileSync(accessPath, "utf8") !== '{"enabled":true}\n')) {
    throw new Error("De interne Access-vlag wijkt af van de gebouwde bundel; bouw opnieuw met dezelfde configuratie.");
  }
  // Een lokale bundel hoort bij precies één profiel, kanaal, origin en versie. Zo kan een bundel van het ene
  // profiel niet stilzwijgend met de instellingen van een ander profiel worden gesynchroniseerd.
  const metadataPath = join(bundleDirectory(process.env), "build.json");
  if (resolved.distribution && !existsSync(metadataPath)) {
    throw new Error(`${metadataPath} ontbreekt. Bouw de bundel eerst met npm run native:build (zelfde profiel en omgevingsvariabelen).`);
  }
  if (existsSync(metadataPath)) {
    const problems = metadataProblems(JSON.parse(readFileSync(metadataPath, "utf8")), resolved);
    if (problems.length > 0) throw new Error(`De bundel in ${metadataPath} hoort niet bij dit profiel:\n- ${problems.join("\n- ")}`);
  }
}

const settings = capacitorSettings(resolved, process.env);
const config: CapacitorConfig = {
  appId: APP_ID,
  appName: "Versado",
  // Geen enkel profiel is een storegoedkeuring. Een lokale bundel is geen release.
  webDir: settings.webDir,
  server: settings.server,
  plugins: {
    ...(access ? { VersadoNative: { internalAccessEnabled: true } } : {}),
    Keyboard: {
      // Laat de bestaande document-scrollcontainer reageren op het toetsenbord
      // zonder pagina's afzonderlijk van native viewportlogica te laten weten.
      resize: KeyboardResize.Body,
    },
    // Capacitor 8 kan de Android-systeeminsets als CSS-variabelen aanbieden;
    // globals.css combineert die met de browser safe-area-variabelen.
    SystemBars: {
      insetsHandling: "css",
    },
  },
};

export default config;
