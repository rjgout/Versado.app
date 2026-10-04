import type { CapacitorConfig } from "@capacitor/cli";

const configuredServerUrl = (process.env.CAPACITOR_SERVER_URL?.trim() || "https://versado.app").replace(/\/+$/, "");
const isLocalServer = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredServerUrl);
const allowCleartext = isLocalServer || process.env.CAPACITOR_ALLOW_CLEARTEXT === "true";

const config: CapacitorConfig = {
  appId: "app.versado.app",
  appName: "Versado",
  // De Next.js-server is dynamisch/SSR; public is alleen de lokale fallback
  // die Capacitor nodig heeft tijdens sync. Native builds laden de server-URL.
  webDir: "public",
  server: {
    url: configuredServerUrl,
    cleartext: allowCleartext,
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
