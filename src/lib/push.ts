import webpush from "web-push";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { isAllowedPushEndpoint } from "@/lib/pushEndpoint";

/**
 * VAPID-sleutelpaar waarmee deze server zich bij pushdiensten (FCM/Mozilla/
 * ...) identificeert. Wordt bij het allereerste gebruik automatisch
 * gegenereerd en in PushSettings opgeslagen (net als EmailSettings een
 * singleton-rij) — geen admin-actie of losse env-var nodig, in
 * tegenstelling tot SMTP, waarvan de gegevens nu eenmaal niet te raden zijn.
 */
let cachedKeys: { publicKey: string; privateKey: string } | null = null;

async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cachedKeys) return cachedKeys;

  const existing = await prisma.pushSettings.findUnique({ where: { id: "singleton" } });
  if (existing) {
    cachedKeys = { publicKey: existing.publicKey, privateKey: decryptSecret(existing.privateKey) };
    return cachedKeys;
  }

  const generated = webpush.generateVAPIDKeys();
  try {
    await prisma.pushSettings.create({
      data: {
        id: "singleton",
        publicKey: generated.publicKey,
        privateKey: encryptSecret(generated.privateKey),
      },
    });
  } catch {
    // Race: een andere request genereerde ondertussen ook al een sleutelpaar
    // en won de unieke-id-constraint — gebruik die in plaats van dubbel te
    // genereren (anders werken oude subscripties met de verkeerde public key).
    const row = await prisma.pushSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    cachedKeys = { publicKey: row.publicKey, privateKey: decryptSecret(row.privateKey) };
    return cachedKeys;
  }

  cachedKeys = generated;
  return cachedKeys;
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapidKeys()).publicKey;
}

/**
 * Het daadwerkelijke versturen, als vervangbaar object: zo kunnen tests
 * vaststellen wie wel en wie geen push krijgt, zonder echte pushdienst.
 */
export const pushTransport = {
  send: (subscription: webpush.PushSubscription, payload: string) => {
    if (!isAllowedPushEndpoint(subscription.endpoint)) return Promise.reject(new Error("Pushbestemming niet toegestaan."));
    return webpush.sendNotification(subscription, payload, { timeout: 10_000 });
  },
};

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  badge?: number;
}

/**
 * Stuurt een pushnotificatie naar alle geregistreerde apparaten van een
 * gebruiker. Verwijdert automatisch subscripties die de pushdienst als
 * verlopen/ingetrokken meldt (404/410) — anders blijft de app tegen een dode
 * endpoint aan praten bij elke volgende notificatie.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  let publicKey: string, privateKey: string;
  try {
    ({ publicKey, privateKey } = await getVapidKeys());
  } catch (e) {
    // Zou hier nooit mogen mislukken, maar zonder log is een kapotte
    // ENCRYPTION_KEY (na bv. een omgevingswijziging) onzichtbaar: elke
    // pushnotificatie verdwijnt dan stil, terwijl e-mail gewoon door blijft
    // werken — precies het soort "push doet niks, mail wel" dat lastig te
    // vinden is zonder deze regel.
    console.error("Kon geen VAPID-sleutelpaar ophalen — pushnotificatie overgeslagen:", e);
    return;
  }
  webpush.setVapidDetails(`mailto:raphael@gout.nl`, publicKey, privateKey);

  await Promise.all(
    subscriptions.map(async (sub) => {
      // Ook oude database-inhoud opnieuw controleren, vóór transport of DNS.
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        await prisma.pushSubscription.deleteMany({ where: { id: sub.id, userId } });
        return;
      }
      try {
        await pushTransport.send(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: payload.url ?? "/",
            badge: payload.badge,
          })
        );
      } catch (e) {
        const statusCode = (e as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          return;
        }
        // Bewust wél loggen (in tegenstelling tot de verlopen-subscriptie-
        // case hierboven, die verwacht is): dit is de enige plek waar een
        // mislukte pushverzending zichtbaar wordt. Zonder deze log verdwijnt
        // elke andere fout (VAPID-probleem, endpoint tijdelijk onbereikbaar,
        // te grote payload, ...) spoorloos — de aanroepende flow (les
        // afronden, vriendschapsverzoek, ...) mag hier terecht niet op
        // wachten/breken, maar dat mag niet betekenen dat de fout nergens
        // terug te vinden is.
        console.error(
          `Pushnotificatie mislukt voor subscriptie ${sub.id}:`,
          statusCode ? `HTTP ${statusCode}` : "Transportfout"
        );
      }
    })
  );
}
