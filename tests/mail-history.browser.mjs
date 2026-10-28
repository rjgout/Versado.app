// Volledige proef uitsluitend met eigen PostgreSQL, synthetische gebruikers en loopback-SMTP.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { sendMail } from "../src/lib/email.ts";
import { encryptSecret, decryptSecret } from "../src/lib/crypto.ts";
import { createAuthToken } from "../src/lib/authTokens.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { cleanupMailHistory, recordMailOpen, trackingHash } from "../src/lib/mailHistory.ts";
import { startPendingRegistration } from "../src/lib/registration.ts";
import { dailyTextFixture, dailyTextTestEnvironment } from "./fixtures/daily-text.ts";

const base = dailyTextTestEnvironment(), fixture = await dailyTextFixture();
const captured = [], sockets = new Set(); let rejectRecipient = false, closeAfterData = false;
const smtp = createServer(socket => {
  sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
  let buffer = "", data = false, message = [];
  socket.write("220 localhost synthetic SMTP\r\n");
  socket.on("data", chunk => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const offset = buffer.indexOf("\n"), line = buffer.slice(0, offset).replace(/\r$/, ""); buffer = buffer.slice(offset + 1);
      if (data) {
        if (line === ".") { captured.push(message.join("\r\n")); message = []; data = false; if (closeAfterData) { socket.destroy(); continue; } socket.write("250 2.0.0 queued synthetic\r\n"); }
        else message.push(line); continue;
      }
      if (/^(EHLO|HELO)/i.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
      else if (/^AUTH/i.test(line)) socket.write("235 2.7.0 authenticated\r\n");
      else if (/^RCPT/i.test(line)) socket.write(rejectRecipient ? "550 5.1.1 rejected local-smtp-secret\r\n" : "250 recipient accepted\r\n");
      else if (/^DATA/i.test(line)) { data = true; socket.write("354 send data\r\n"); }
      else if (/^QUIT/i.test(line)) { socket.end("221 bye\r\n"); }
      else socket.write("250 ok\r\n");
    }
  });
});
await new Promise(resolve => smtp.listen(0, "127.0.0.1", resolve));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const output = "/tmp/versado-mail-history-browser"; mkdirSync(output, { recursive: true });
const users = [];
async function account(admin = false) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@mail-history.test.invalid`, passwordHash: "synthetic", handle: `Mail${randomUUID().slice(0,8)}`, discriminator: "00", isAdmin: admin, uiLanguage: "nl", timeZone: "UTC", emailVerifiedAt: admin ? new Date() : null, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), avatarCharacterId: "nephi", activeContentCollectionId: fixture.own.id, kompasOffersEnabled: false } });
  users.push(user.id); return user;
}
const lastMail = recipient => prisma.mailMessage.findFirstOrThrow({ where: { recipient }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
const post = (context, id) => context.request.post(`${base}/api/admin/mail-history/${id}/resend`, { headers: { Origin: base } });
const send = (recipient, subject = "Synthetische mail", meta = {}) => sendMail({ to: recipient, subject, text: "Veilige testtekst https://example.invalid/actie?token=" + "A".repeat(43), html: "<p>Veilige testtekst</p>", meta: { kind: "TEST", ...meta } });
const pixelOf = value => value.replace(/=\r\n/g, "").match(/\/api\/mail\/open\/([A-Za-z0-9_-]{43})/)?.[1];
try {
  const admin = await account(true), user = await account();
  const snapshot = () => prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: "asc" }, select: { id: true, passwordHash: true, sessionVersion: true, xpTotal: true, currentStreak: true, longestStreak: true, freezeCount: true, mustChangePassword: true } });
  const before = await snapshot();
  await prisma.emailSettings.upsert({ where: { id: "singleton" }, update: { enabled: true, trackOpens: true, smtpHost: "127.0.0.1", smtpPort: smtp.address().port, smtpSecure: false, smtpUsername: "local-test", smtpPasswordEnc: encryptSecret("local-smtp-secret"), fromEmail: "synthetic@example.invalid", fromName: "Versado test" }, create: { id: "singleton", enabled: true, trackOpens: true, smtpHost: "127.0.0.1", smtpPort: smtp.address().port, smtpUsername: "local-test", smtpPasswordEnc: encryptSecret("local-smtp-secret"), fromEmail: "synthetic@example.invalid" } });
  assert.equal((await send(user.email)).ok, true);
  const original = await lastMail(user.email), pixel = pixelOf(captured.at(-1)); assert.ok(pixel);
  assert.equal(original.status, "ACCEPTED"); assert.ok(original.smtpMessageId); assert.ok(original.smtpResponse);
  assert.equal(original.trackingHash, trackingHash(pixel)); assert.equal(original.previewText.includes("A".repeat(43)), false);
  assert.equal(decryptSecret(original.payloadEnc).includes("/api/mail/open/"), false);

  const anonymous = await browser.newContext(), ordinary = await browser.newContext(), operator = await browser.newContext({ viewport: { width: 320, height: 720 } });
  await ordinary.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  await operator.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(admin.id), url: base }]);
  assert.equal((await anonymous.request.get(`${base}/api/admin/mail-history`)).status(), 401);
  assert.equal((await ordinary.request.get(`${base}/api/admin/mail-history`)).status(), 403);
  assert.equal((await post(ordinary, original.id)).status(), 403);
  assert.equal((await post(anonymous, original.id)).status(), 401);
  assert.equal((await operator.request.post(`${base}/api/admin/mail-history/${original.id}/resend`, { headers: { Origin: "https://foreign.invalid" } })).status(), 403);
  assert.equal((await operator.request.get(`${base}/api/admin/mail-history?page=-1`)).status(), 400);
  const listing = await operator.request.get(`${base}/api/admin/mail-history`); assert.equal(listing.status(), 200);
  const json = await listing.json(); assert.equal(JSON.stringify(json).includes(original.trackingHash), false); assert.equal(JSON.stringify(json).includes(original.payloadEnc), false);
  assert.equal(JSON.stringify(json).includes("local-smtp-secret"), false);

  const path = `${base}/api/mail/open/${pixel}`;
  assert.equal((await anonymous.request.head(path)).status(), 200);
  assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: original.id } })).openCount, 0);
  const opened = await anonymous.request.get(path); assert.equal(opened.headers()["content-type"], "image/gif"); assert.ok(opened.headers()["cache-control"].includes("no-store"));
  await Promise.all(Array.from({ length: 8 }, () => anonymous.request.get(path)));
  let row = await prisma.mailMessage.findUniqueOrThrow({ where: { id: original.id } }); assert.equal(row.openCount, 9); assert.ok(row.firstOpenedAt); assert.ok(row.lastOpenedAt);
  assert.deepEqual(await (await anonymous.request.get(`${base}/api/mail/open/invalid`)).body(), await opened.body());
  await prisma.emailSettings.update({ where: { id: "singleton" }, data: { trackOpens: false } });
  await anonymous.request.get(path); assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: original.id } })).openCount, 9);
  await send(user.email, "Zonder tracking"); assert.equal((await lastMail(user.email)).trackingHash, null); assert.equal(pixelOf(captured.at(-1)), undefined);
  await prisma.emailSettings.update({ where: { id: "singleton" }, data: { trackOpens: true } });
  await recordMailOpen(pixel, new Date(Date.now() + 91 * 86400_000));
  assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: original.id } })).openCount, 9);

  rejectRecipient = true; assert.equal((await send(user.email, "Afgewezen ontvanger")).ok, false);
  row = await lastMail(user.email); assert.equal(row.status, "FAILED"); assert.equal(row.error.includes("local-smtp-secret"), false); rejectRecipient = false;
  await prisma.emailSettings.update({ where: { id: "singleton" }, data: { enabled: false } });
  assert.equal((await send(user.email, "SMTP uit")).ok, false); assert.equal((await lastMail(user.email)).status, "SKIPPED");
  await prisma.emailSettings.update({ where: { id: "singleton" }, data: { enabled: true } });

  closeAfterData = true;
  assert.equal((await send(user.email, "Bevestiging verloren na DATA")).ok, false);
  assert.equal((await lastMail(user.email)).status, "UNKNOWN");
  closeAfterData = false;

  const count = captured.length;
  const claims = await Promise.all([post(operator, original.id), post(operator, original.id)]);
  assert.deepEqual(claims.map(response => response.status()).sort(), [200, 429]); assert.equal(captured.length, count + 1);
  const retry = await lastMail(user.email); assert.equal(retry.resendOfId, original.id); assert.equal(retry.actorId, admin.id);
  assert.notEqual(retry.trackingHash, original.trackingHash); assert.notEqual(pixelOf(captured.at(-1)), pixel);
  assert.equal((await post(operator, retry.id)).status(), 429);
  await anonymous.request.get(`${base}/api/mail/open/${pixelOf(captured.at(-1))}`);
  assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: retry.id } })).openCount, 1);
  assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: original.id } })).openCount, 9);

  const token = await createAuthToken(user.id, "EMAIL_VERIFY");
  await sendMail({ to: user.email, subject: "Account bevestigen", text: `${base}/verify-email?token=${token}`, html: `<a href="${base}/verify-email?token=${token}">Bevestigen</a>`, meta: { kind: "EMAIL_VERIFY", userId: user.id } });
  const verification = await lastMail(user.email); assert.equal(verification.payloadEnc, null); assert.equal(JSON.stringify(verification).includes(token), false);
  const authCount = await prisma.authToken.count({ where: { userId: user.id } });
  assert.equal((await post(operator, verification.id)).status(), 200);
  assert.equal(await prisma.authToken.count({ where: { userId: user.id } }), authCount + 1);
  assert.equal((await lastMail(user.email)).payloadEnc, null);
  assert.equal(captured.at(-1).replace(/=\r\n/g, "").includes(token), false);
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  assert.equal((await post(operator, verification.id)).status(), 409);

  const reset = await createAuthToken(user.id, "PASSWORD_RESET");
  await sendMail({ to: user.email, subject: "Wachtwoord herstellen", text: `${base}/reset-password?token=${reset}`, html: `<a href="${base}/reset-password?token=${reset}">Herstellen</a>`, meta: { kind: "PASSWORD_RESET", userId: user.id } });
  const resetMail = await lastMail(user.email); assert.equal(resetMail.payloadEnc, null);
  assert.equal((await post(operator, resetMail.id)).status(), 200);
  await prisma.user.update({ where: { id: user.id }, data: { email: "changed@mail-history.test.invalid" } });
  assert.equal((await post(operator, resetMail.id)).status(), 409);
  await prisma.user.update({ where: { id: user.id }, data: { email: user.email } });

  await sendMail({ to: user.email, subject: "Notificatie met uitschrijven", text: "Synthetische notificatie", html: "<p>Notificatie</p>", headers: { "List-Unsubscribe": `<${base}/unsubscribe?token=synthetic>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, meta: { kind: "NOTIFICATION", userId: user.id, category: "dailyText" } });
  const notification = await lastMail(user.email); assert.equal((await post(operator, notification.id)).status(), 409);
  await prisma.user.update({ where: { id: user.id }, data: { emailNotificationsEnabled: true, notifyDailyText: false } });
  assert.equal((await post(operator, notification.id)).status(), 409);
  await prisma.user.update({ where: { id: user.id }, data: { notifyDailyText: true } });
  await prisma.mailMessage.update({ where: { id: notification.id }, data: { lastResendAt: null } });
  assert.equal((await post(operator, notification.id)).status(), 200);
  assert.ok(captured.at(-1).toLowerCase().includes("list-unsubscribe:"));

  const pendingEmail = "pending@mail-history.test.invalid";
  await startPendingRegistration({ email: pendingEmail, handle: "PendingMail", passwordHash: "synthetic", uiLanguage: "nl", contentLanguage: "nl" }, base);
  const pending = await lastMail(pendingEmail), oldHash = (await prisma.pendingRegistration.findUniqueOrThrow({ where: { email: pendingEmail } })).tokenHash;
  assert.equal(pending.kind, "PENDING_VERIFY"); assert.equal(pending.payloadEnc, null);
  assert.equal((await post(operator, pending.id)).status(), 200);
  assert.notEqual((await prisma.pendingRegistration.findUniqueOrThrow({ where: { email: pendingEmail } })).tokenHash, oldHash);

  await sendMail({ to: user.email, subject: "Bijlage", text: "Met bijlage", html: "<p>Met bijlage</p>", attachments: [{ filename: "synthetic.txt", content: Buffer.from("synthetic"), contentType: "text/plain" }], meta: { kind: "FEEDBACK" } });
  const attachment = await lastMail(user.email); assert.equal(attachment.payloadEnc, null); assert.equal((await post(operator, attachment.id)).status(), 409);
  const expired = await prisma.mailMessage.create({ data: { recipient: "expired@example.invalid", subject: "Expired mail", previewText: "x", kind: "TEST", status: "ACCEPTED", createdAt: new Date(Date.now() - 91 * 86400_000) } });
  const interrupted = await prisma.mailMessage.create({ data: { recipient: user.email, subject: "Onderbroken", previewText: "x", kind: "TEST", status: "SENDING", createdAt: new Date(Date.now() - 11 * 60_000) } });
  assert.equal((await (await operator.request.get(`${base}/api/admin/mail-history?q=expired`)).json()).total, 0);
  await cleanupMailHistory();
  assert.equal(await prisma.mailMessage.findUnique({ where: { id: expired.id } }), null);
  assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: interrupted.id } })).status, "UNKNOWN");
  await prisma.mailMessage.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ recipient: user.email, subject: `Paginafixture ${i}`, previewText: "<script>throw new Error('must-not-run')</script> https://example.invalid", kind: "TEST", status: "ACCEPTED" })) });
  const pages = await (await operator.request.get(`${base}/api/admin/mail-history?q=Paginafixture&page=1`)).json(); assert.equal(pages.total, 30); assert.equal(pages.items.length, 5);
  const page = await operator.newPage(), errors = [], pixelRequests = []; page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.url().includes("/api/mail/open/")) pixelRequests.push(request.url()); });
  await page.clock.install();
  await page.goto(`${base}/adminbackend/communicatie`);
  await page.locator("[data-mail-entry]").first().waitFor();
  await page.getByLabel("Zoeken", { exact: true }).fill("Paginafixture");
  await Promise.all([page.waitForResponse(response => response.url().includes("/api/admin/mail-history?") && response.url().includes("Paginafixture")), page.getByRole("button", { name: "Toepassen", exact: true }).click()]);
  await page.locator("[data-mail-entry] details summary").first().click();
  assert.equal(await page.locator("[data-mail-preview] script").count(), 0); assert.equal(pixelRequests.length, 0);
  await page.screenshot({ path: `${output}/mobile.png` });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: `${output}/mobile-large.png` });
  // Nieuwe mail verschijnt door de centrale klok zonder navigatie of handmatige verversing.
  await prisma.mailMessage.create({ data: { recipient: user.email, subject: "Paginafixture nieuw live", previewText: "nieuw", kind: "TEST", status: "ACCEPTED" } });
  await Promise.all([page.waitForResponse(response => response.url().includes("/api/admin/mail-history?")), page.clock.fastForward(75_000)]);
  await page.getByText("Paginafixture nieuw live", { exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.equal(pixelRequests.length, 0);
  const removed = await account();
  await send(removed.email, "Verwijderde gebruiker", { userId: removed.id });
  await prisma.user.delete({ where: { id: removed.id } });
  assert.equal(await prisma.mailMessage.count({ where: { recipient: removed.email } }), 0);
  assert.deepEqual(await snapshot(), before);
  console.log("Mailhistorie: echte loopback-SMTP; acceptatie/weigering/configuratie; auth/CSRF; veilige preview; pixels/HEAD/uitzetten/verval/concurrentie; nieuwe beveiligingslinks; voorkeuren; herverzendclaim/audit; bewaring; paginafilters; live 320px/200%; XP, reeks, wachtwoord en sessies behouden.");
} finally {
  await browser.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => smtp.close(resolve));
  await prisma.$disconnect();
}
