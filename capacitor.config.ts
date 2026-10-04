import type { CapacitorConfig } from "@capacitor/cli";

const buildProfile = process.env.CAPACITOR_BUILD_PROFILE?.trim();
const configuredServerUrl = process.env.CAPACITOR_SERVER_URL?.trim()?.replace(/\/+$/, "");

if (!buildProfile) {
  throw new Error(
    "CAPACITOR_BUILD_PROFILE ontbreekt. Kies 'remote-preview' voor lokale/native preview; een productieprofiel is nog geblokkeerd totdat de lokale client/API-migratie klaar is."
  );
}

if (buildProfile !== "remote-preview") {
  throw new Error(
    `CAPACITOR_BUILD_PROFILE=${buildProfile} wordt niet ondersteund. De native productiebuild blijft geblokkeerd totdat Versado een lokale client met expliciete API/auth-grens heeft.`
  );
}

if (!configuredServerUrl) {
  throw new Error(
    "CAPACITOR_SERVER_URL ontbreekt. Geef voor remote-preview expliciet een HTTPS Versado-adres op, of een HTTP LAN-adres met CAPACITOR_ALLOW_CLEARTEXT=true voor lokale ontwikkeling."
  );
}

const isLocalServer = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredServerUrl);
const allowCleartext = isLocalServer || process.env.CAPACITOR_ALLOW_CLEARTEXT === "true";

const config: CapacitorConfig = {
  appId: "app.versado.app",
  appName: "Versado",
  // De huidige app is dynamisch/SSR. public bevat daarom alleen statische
  // assets en de foutpagina; remote-preview is bewust geen storeprofiel.
  webDir: "public",
  server: {
    url: configuredServerUrl,
    cleartext: allowCleartext,
    errorPath: "native-error.html",
  },
  plugins: {
    Keyboard: {
      // Laat de bestaande document-scrollcontainer reageren op het toetsenbord
      // zonder pagina's afzonderlijk van native viewportlogica te laten weten.
      resize: "body",
    },
    // Capacitor 8 kan de Android-systeeminsets als CSS-variabelen aanbieden;
    // globals.css combineert die met de browser safe-area-variabelen.
    SystemBars: {
      insetsHandling: "css",
    },
  },
};

export default config;
