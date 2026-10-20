import { createHash, randomBytes } from "crypto";
import { Prisma, type PendingRegistration, type User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { generateDiscriminator } from "@/lib/handle";
import { FRONT_TO_BACK_SLUG, subscribeUserToCourse } from "@/lib/courses";
import { BOFM_WORK, resolveEditionId } from "@/lib/contentCollections";
import { becomeFriendsViaInvite } from "@/lib/friendInvite";
import { sendMail } from "@/lib/email";
import { verifyEmailTemplate } from "@/lib/emailTemplates";
import { getT } from "@/lib/i18n";
import { failureLockSeconds, registerFailure } from "@/lib/rateLimit";
import { leaveAllGroups } from "@/lib/social/groups";

// Registreren met e-mailbevestiging: eerst een PendingRegistration, pas bij
// het klikken op de link een User. Zonder e-mailconfiguratie maakt
// /api/auth/register direct een account (createAccount), zoals altijd.
// Dit bestand zit via scheduler.ts in de eager-keten van server.ts: dus
// geen next/headers of andere request-gebonden API's hier.

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
// Verlopen en bevestigde aanmeldingen blijven nog een week staan: dan kan
// inloggen nog "bevestig eerst" zeggen en een nieuwe link sturen, en toont
// een tweede klik op een gebruikte link "al bevestigd".
const PENDING_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const UNVERIFIED_ACCOUNT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DISCRIMINATOR_ATTEMPTS = 25;
// Hooguit drie bevestigingsmails per adres per uur, wie ze ook aanvraagt:
// anders is registreren een manier om iemands inbox te vullen.
const MAIL_WINDOW_MS = 60 * 60 * 1000;
const MAX_MAILS_PER_WINDOW = 3;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function mailKey(email: string): string {
  return `verify-mail:${createHash("sha256").update(email).digest("hex")}`;
}

function mayMail(email: string): boolean {
  return failureLockSeconds(mailKey(email), MAX_MAILS_PER_WINDOW) === 0;
}

export function verifyLink(baseUrl: string, rawToken: string): string {
  return `${baseUrl}/verify-email?token=${rawToken}`;
}

/** Een e-mailadres al als account in gebruik (gelijktijdige bevestiging). */
class EmailTakenError extends Error {}

export interface NewAccount {
  email: string;
  handle: string;
  passwordHash: string;
  uiLanguage: string;
  contentLanguage: string;
  inviteCode?: string | null;
  emailVerifiedAt: Date | null;
  externalIdentity?: { scope: string; subject: string; displayName?: string };
}

/**
 * Maakt het account met alles wat erbij hoort: nummer achter de naam,
 * startcursus en (via een uitnodigingslink) de vriendschap. De enige plek
 * waar een User ontstaat.
 */
export async function createAccount(input: NewAccount): Promise<User> {
  // De allereerste registratie op een verse installatie wordt automatisch
  // admin, zodat er zonder handmatige databasetoegang altijd een beheerder
  // is voor /adminbackend.
  const isFirstUser = (await prisma.user.count()) === 0;

  // Standaardcursus: "van voor naar achter" in de uitgave van de eigen
  // contenttaal. Bestaat die nog niet (content nog niet geïmporteerd), dan
  // blijft dit leeg en vangt dashboard/page.tsx dat later af.
  const editionId = await resolveEditionId(BOFM_WORK, input.contentLanguage);
  const defaultCourse =
    (editionId && (await prisma.course.findFirst({ where: { type: "FRONT_TO_BACK", contentCollectionId: editionId } }))) ||
    (await prisma.course.findUnique({ where: { slug: FRONT_TO_BACK_SLUG } }));

  let user: User | null = null;
  // handle+discriminator is uniek, handle alleen niet: bij een botsing
  // (1 op 100 voor exact dezelfde combinatie) een nieuw nummer proberen.
  for (let attempt = 0; attempt < MAX_DISCRIMINATOR_ATTEMPTS && !user; attempt++) {
    try {
      user = await prisma.user.create({
        data: {
          email: input.email,
          handle: input.handle,
          discriminator: generateDiscriminator(),
          passwordHash: input.passwordHash,
          passwordLoginEnabled: !input.externalIdentity,
          ...(input.externalIdentity ? { externalIdentities: { create: { provider: "APPLE" as const, ...input.externalIdentity } } } : {}),
          isAdmin: isFirstUser && !input.externalIdentity,
          activeCourseId: defaultCourse?.id,
          uiLanguage: input.uiLanguage,
          contentLanguage: input.contentLanguage,
          emailVerifiedAt: input.emailVerifiedAt,
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
      const target = (e.meta?.target as string[] | string | undefined) ?? [];
      if (String(target).includes("email")) throw new EmailTakenError();
      if (input.externalIdentity && String(target).includes("provider")) throw e;
    }
  }
  if (!user) throw new Error("Geen vrij nummer gevonden voor deze gebruikersnaam.");

  // Meteen in de persoonlijke cursussenlijst, anders blijft die leeg tot de
  // gebruiker toevallig een pagina bezoekt die dit lazy aanmaakt.
  if (defaultCourse) await subscribeUserToCourse(prisma, user.id, defaultCourse.id);

  // Een ongeldige of vervangen uitnodigingslink mag het account nooit laten
  // mislukken: dan wordt het gewoon een account zonder vriend.
  if (input.inviteCode) {
    const invite = await becomeFriendsViaInvite(input.inviteCode, user.id, { isNewAccount: true }).catch(() => null);
    if (invite?.ok) await prisma.user.update({ where: { id: user.id }, data: { registeredViaInvite: true } });
  }
  return user;
}

async function mailLink(email: string, uiLanguage: string, baseUrl: string, rawToken: string): Promise<void> {
  registerFailure(mailKey(email), MAIL_WINDOW_MS);
  const { subject, html, text } = verifyEmailTemplate(getT(uiLanguage), verifyLink(baseUrl, rawToken));
  const result = await sendMail({ to: email, subject, html, text });
  if (!result.ok) console.error("Bevestigingsmail niet verstuurd:", result.error);
}

export interface PendingInput {
  email: string;
  handle: string;
  passwordHash: string;
  uiLanguage: string;
  contentLanguage: string;
  inviteCode?: string | null;
  returnTo?: string | null;
}

/**
 * Zet een aanmelding klaar en mailt de link (die ook teruggegeven wordt, voor
 * tests; null = mailgrens bereikt). Een eerdere aanmelding met
 * hetzelfde adres wordt vervangen (nieuwe naam, wachtwoord en link), zodat
 * niemand andermans adres kan bezetten. Is de mailgrens voor dit adres
 * bereikt, dan verandert er niets: anders zou de link uit de vorige mail
 * ongeldig worden zonder dat er een nieuwe komt.
 */
export async function startPendingRegistration(input: PendingInput, baseUrl: string): Promise<string | null> {
  if (!mayMail(input.email)) return null;
  const raw = randomBytes(32).toString("base64url");
  const fields = {
    handle: input.handle,
    passwordHash: input.passwordHash,
    uiLanguage: input.uiLanguage,
    contentLanguage: input.contentLanguage,
    inviteCode: input.inviteCode ?? null,
    returnTo: input.returnTo ?? null,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    confirmedAt: null,
  };
  await prisma.pendingRegistration.upsert({
    where: { email: input.email },
    create: { email: input.email, ...fields },
    update: fields,
  });
  await mailLink(input.email, input.uiLanguage, baseUrl, raw);
  return raw;
}

/** De nog niet bevestigde aanmelding voor dit adres, ook als de link verlopen is. */
export async function findOpenPendingRegistration(email: string): Promise<PendingRegistration | null> {
  return prisma.pendingRegistration.findFirst({ where: { email, confirmedAt: null } });
}

/** Nieuwe link (de oude vervalt), binnen de mailgrens; null = grens bereikt. */
export async function resendPendingVerification(pending: PendingRegistration, baseUrl: string): Promise<string | null> {
  if (!mayMail(pending.email)) return null;
  const raw = randomBytes(32).toString("base64url");
  await prisma.pendingRegistration.update({
    where: { id: pending.id },
    data: { tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
  });
  await mailLink(pending.email, pending.uiLanguage, baseUrl, raw);
  return raw;
}

export type ConfirmResult =
  | { status: "confirmed"; user: User; returnTo: string | null }
  | { status: "already" | "expired" | "notPending" };

/**
 * Bevestigt een aanmelding en maakt dan pas het account. Twee gelijktijdige
 * klikken op dezelfde link geven één account: alleen wie de rij als eerste
 * op bevestigd zet, gaat door. "notPending" = geen aanmelding met deze link;
 * de aanroeper probeert dan nog de oude bevestigingslinks van bestaande accounts.
 */
export async function confirmPendingRegistration(rawToken: string, now: Date = new Date()): Promise<ConfirmResult> {
  const pending = await prisma.pendingRegistration.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!pending) return { status: "notPending" };
  if (pending.confirmedAt) return { status: "already" };
  if (pending.expiresAt < now) return { status: "expired" };

  // Het wachtwoord-hash hoeft na bevestiging niet nog een week dubbel te bestaan.
  const claim = await prisma.pendingRegistration.updateMany({
    where: { id: pending.id, confirmedAt: null },
    data: { confirmedAt: now, passwordHash: "" },
  });
  if (claim.count === 0) return { status: "already" };

  try {
    if (await prisma.user.findUnique({ where: { email: pending.email }, select: { id: true } })) return { status: "already" };
    const user = await createAccount({
      email: pending.email,
      handle: pending.handle,
      passwordHash: pending.passwordHash,
      uiLanguage: pending.uiLanguage,
      contentLanguage: pending.contentLanguage,
      inviteCode: pending.inviteCode,
      emailVerifiedAt: now,
    });
    return { status: "confirmed", user, returnTo: pending.returnTo };
  } catch (e) {
    if (e instanceof EmailTakenError) return { status: "already" };
    // Mislukt om een andere reden: de link moet het dan gewoon nog eens doen.
    await prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: { confirmedAt: null, passwordHash: pending.passwordHash },
    });
    throw e;
  }
}

/**
 * Opruimen (uurlijks vanuit scheduler.ts): oude aanmeldingen, en accounts
 * van vóór deze aanmeldingsstap die na 30 dagen nog steeds niet bevestigd
 * zijn en nooit iets gedaan hebben. Alleen accounts die ooit een
 * bevestigingslink kregen: wie registreerde toen e-mail nog niet was
 * ingesteld, heeft nooit kunnen bevestigen en blijft staan. Beheerders
 * blijven altijd staan.
 */
export async function cleanupRegistrations(now: Date = new Date()): Promise<{ pending: number; accounts: number }> {
  const keepUntil = new Date(now.getTime() - PENDING_KEEP_MS);
  const pending = await prisma.pendingRegistration.deleteMany({
    where: {
      OR: [{ confirmedAt: null, expiresAt: { lt: keepUntil } }, { confirmedAt: { lt: keepUntil } }],
    },
  });

  const stale = await prisma.user.findMany({
    where: {
      emailVerifiedAt: null,
      isAdmin: false,
      createdAt: { lt: new Date(now.getTime() - UNVERIFIED_ACCOUNT_MAX_AGE_MS) },
      xpTotal: 0,
      authTokens: { some: { type: "EMAIL_VERIFY" } },
      streakDays: { none: {} },
      xpTx: { none: {} },
    },
    select: { id: true },
    take: 100,
  });
  let accounts = 0;
  for (const { id } of stale) {
    try {
      // Net als bij zelf verwijderen: eerst uit elke groep, zodat ledentallen
      // kloppen; de cascade ruimt de rest op.
      await leaveAllGroups(id, now);
      await prisma.user.delete({ where: { id } });
      accounts++;
    } catch (e) {
      console.error(`Onbevestigd account ${id} opruimen mislukt:`, e);
    }
  }
  return { pending: pending.count, accounts };
}
