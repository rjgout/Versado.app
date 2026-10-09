import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { resolveAppName } from "@/lib/brand";
import { formatTag } from "@/lib/handle";
import { findInviter } from "@/lib/friendInvite";
import { getT } from "@/lib/i18n";
import { requestLanguage } from "@/lib/requestLanguage";
import UserAvatar from "@/components/UserAvatar";
import VisualIdentityIcon from "@/components/versado/VisualIdentityIcon";
import InviteAcceptButton from "@/components/InviteAcceptButton";
import HomeContent from "@/components/home/HomeContent";
import { getGameSettings } from "@/lib/gameSettings";
import Footer from "@/components/Footer";

// Bewust ook zonder inlog bereikbaar: dit is de pagina die iemand via een
// appje opent, vaak nog zonder account.
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [user, inviter, branding] = await Promise.all([getCurrentUser(), findInviter(code), getBranding()]);
  const appName = resolveAppName(branding.appName);
  const t = getT(await requestLanguage(user));

  if (!inviter) {
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-4 text-center">
        <div className="text-5xl" aria-hidden>
          🔗
        </div>
        <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">{t("invitePage.invalid")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("invitePage.askNewLink")}
        </p>
        {user ? (
          <Link href="/friends" className="btn-primary">
            {t("invitePage.toFriends")}
          </Link>
        ) : (
          <Link href="/register" className="btn-primary">
            {t("invitePage.createAnyway")}
          </Link>
        )}
      </div>
    );
  }

  const inviterTag = formatTag(inviter.handle, inviter.discriminator);

  let action: React.ReactNode;
  if (!user) {
    action = (
      <>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("invitePage.createToBefriend")}
        </p>
        <div className="flex flex-col gap-2 w-full">
          <Link href={`/register?invite=${encodeURIComponent(code)}`} className="btn-primary">
            {t("auth.createAccount")}
          </Link>
          <Link href={`/login?next=${encodeURIComponent(`/uitnodiging/${code}`)}`} className="btn-secondary">
            {t("invitePage.haveAccount")}
          </Link>
        </div>
      </>
    );
  } else if (user.id === inviter.id) {
    action = (
      <>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("invitePage.ownLink")}
        </p>
        <Link href="/friends" className="btn-primary">
          {t("invitePage.toFriends")}
        </Link>
      </>
    );
  } else {
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: inviter.id, receiverId: user.id },
          { senderId: user.id, receiverId: inviter.id },
        ],
      },
      select: { id: true },
    });
    action = friendship ? (
      <>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("invitePage.alreadyFriends")}</p>
        <Link href="/friends" className="btn-primary">
          {t("invitePage.toFriends")}
        </Link>
      </>
    ) : (
      <InviteAcceptButton code={code} inviterId={inviter.id} inviterName={inviter.handle} />
    );
  }

  const hero = (
    <div className="w-full max-w-md card flex flex-col items-center gap-4 text-center">
      <VisualIdentityIcon asset="invite" className="h-16 w-16" sizes="64px" />
      <UserAvatar id={inviter.id} handle={inviter.handle} avatarEmoji={inviter.avatarEmoji} size="md" />
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">
        {t("invitePage.invitesYou", { tag: inviterTag, app: appName })}
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("home.tagline")}</p>
      {action}
    </div>
  );

  // Wie al een account heeft, kent de app: dan alleen de uitnodiging zelf.
  if (user) return <div className="flex justify-center">{hero}</div>;

  // Zonder account eerst de persoonlijke boodschap, en daaronder de hele
  // homepagina, zodat de uitgenodigde ziet waar die voor gevraagd wordt.
  // De aanmeldknoppen daar nemen de uitnodiging mee.
  const games = await getGameSettings();
  return (
    <>
      <div className="flex justify-center">{hero}</div>
      <HomeContent
        t={t}
        displayName={appName}
        games={games}
        signUpHref={`/register?invite=${encodeURIComponent(code)}`}
        loginHref={`/login?next=${encodeURIComponent(`/uitnodiging/${code}`)}`}
        heroAs="h2"
      />
      <Footer />
    </>
  );
}
