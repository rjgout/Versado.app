import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const buildProfile = process.env.CAPACITOR_BUILD_PROFILE?.trim();
const configuredServerUrl = process.env.CAPACITOR_SERVER_URL?.trim()?.replace(/\/+$/, "");

if (!buildProfile) {
  throw new Error(
    "CAPACITOR_BUILD_PROFILE ontbreekt. Kies 'remote-preview' voor lokale/native preview; een productieprofiel is nog geblokkeerd totdat de lokale client/API-migratie klaar is."
  );
}

if (buildProfile !== "remote-preview" && buildProfile !== "local-development") {
  throw new Error(
    `CAPACITOR_BUILD_PROFILE=${buildProfile} wordt niet ondersteund. De native productiebuild blijft geblokkeerd totdat Versado een lokale client met expliciete API/auth-grens heeft.`
  );
}

if (buildProfile === "remote-preview" && !configuredServerUrl) {
  throw new Error(
    "CAPACITOR_SERVER_URL ontbreekt. Geef voor remote-preview expliciet een HTTPS Versado-adres op, of een HTTP LAN-adres met CAPACITOR_ALLOW_CLEARTEXT=true voor lokale ontwikkeling."
  );
}

const isLocalServer = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredServerUrl ?? "");
const allowCleartext = isLocalServer || process.env.CAPACITOR_ALLOW_CLEARTEXT === "true";

if (buildProfile === "local-development" && configuredServerUrl) throw new Error("Een lokale client mag geen remote server.url krijgen.");

const config: CapacitorConfig = {
  appId: "app.versado.app",
  appName: "Versado",
  // Beide profielen zijn development. Een lokale bundle is geen storegoedkeuring.
  webDir: buildProfile === "local-development" ? "dist/native" : "public",
  server: buildProfile === "local-development" ? { androidScheme: "https", iosScheme: "capacitor", cleartext: process.env.NATIVE_ALLOW_LOCAL_HTTP_API === "1" } : {
    url: configuredServerUrl,
    cleartext: allowCleartext,
    errorPath: "native-error.html",
  },
  plugins: {
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
