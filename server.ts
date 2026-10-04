import { createServer } from "http";
import next from "next";
import { initGameServer } from "./src/server/gameServer";
import { startNotificationSchedulers } from "./src/lib/scheduler";
import { APP_NAME } from "./src/lib/brand";
import { syncHeaderLogo } from "./src/lib/branding";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  syncHeaderLogo().catch((error) => {
    // De app moet ook zonder de optionele gedeelde branding-map kunnen
    // starten; Huisstijl kan bij de volgende wijziging opnieuw synchroniseren.
    console.warn("Headerlogo kon niet naar de onderhoudsproxy worden gesynchroniseerd.", error);
  });

  // Zonder eigen geparste URL: Next leest req.url zelf. Het oude
  // url.parse() is onveilig en geeft vanaf Node 24 een waarschuwing.
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  initGameServer(httpServer);
  startNotificationSchedulers();

  // Geen host doorgeven aan listen(): dit bindt op alle interfaces (0.0.0.0),
  // nodig zodat andere containers (bv. cloudflared) de app kunnen bereiken.
  httpServer.listen(port, () => {
    console.log(`> ${APP_NAME} luistert op poort ${port} (bereikbaar op http://localhost:${port} lokaal)`);
  });
});
