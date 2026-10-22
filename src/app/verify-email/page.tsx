import EmailConfirmationCard from "@/components/account/EmailConfirmationCard";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import ResendVerificationButton from "@/components/ResendVerificationButton";
import ContinueAfterVerify from "@/components/ContinueAfterVerify";
import { safeReturnPath } from "@/lib/returnTo";
import { getT } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { requestLanguage } from "@/lib/requestLanguage";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string; next?: string }>;
}) {
  const { token, status, next } = await searchParams;
  // Het token verwerkt een route (die kan inloggen door een cookie te zetten);
  // daarna komt de uitkomst hier terug als ?status=.
  if (token) redirect(`/api/auth/verify-email/confirm?token=${encodeURIComponent(token)}`);

  const user = await getCurrentUser();
  const t = getT(await requestLanguage(user));

  if (status === "confirmed") {
    return (
      <EmailConfirmationCard status="confirmed" title={t("verify.confirmed")}>
        <ContinueAfterVerify next={safeReturnPath(next)} />
      </EmailConfirmationCard>
    );
  }

  if (status === "already" || status === "expired" || status === "invalid") {
    const title = status === "already" ? t("verify.alreadyTitle") : status === "expired" ? t("verify.expiredTitle") : t("verify.invalid");
    // Een ingelogd account van vóór de aanmeldingsstap vraagt hier zelf een
    // nieuwe link aan; verder loopt een nieuwe link via inloggen.
    const legacyUnverified = status !== "already" && user && !user.emailVerifiedAt;
    return (
      <EmailConfirmationCard status={status} title={title}>
        {legacyUnverified ? (
          <>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t("verify.requestNew")}</p>
            <ResendVerificationButton />
          </>
        ) : user && status === "already" ? (
          <ContinueAfterVerify next={null} />
        ) : (
          <>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{status === "already" ? t("verify.alreadyText") : t("verify.newLinkViaLogin")}</p>
            <Link href="/login" className="btn-primary self-center">
              {t("auth.logIn")}
            </Link>
          </>
        )}
      </EmailConfirmationCard>
    );
  }

  if (!user) redirect("/login");
  if (user.emailVerifiedAt) redirect("/dashboard");

  return (
    <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">{t("verify.title")}</h1>
      <p className="text-slate-500 dark:text-slate-400 text-sm">
        {rich(t("verify.sentTo"), { email: <strong>{user.email}</strong> })}
      </p>
      <ResendVerificationButton />
    </div>
  );
}
