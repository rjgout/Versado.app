import { BookOpenCheck, Gamepad2, MessageSquare, Server, Users } from "lucide-react";
import AdminCategoryCard from "@/components/admin/AdminCategoryCard";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { requireAdminPage } from "@/lib/adminGuard";
import { prisma } from "@/lib/db";
import { getEmailSettingsView } from "@/lib/email";
import { getContentSwitcherSettings } from "@/lib/contentCollections";
import { isDeployAgentConfigured } from "@/lib/deployAgent";
import packageJson from "../../../package.json";
import { getT } from "@/lib/i18n";

// De hoofdpagina van het beheer: alleen ingangen en echte tellingen. Elke groep heeft
// een eigen pagina met de bestaande beheerblokken; er is niets verwijderd of verplaatst
// buiten die pagina's.
export default async function AdminBackendPage() {
  const user = await requireAdminPage();
  const t = getT(user.uiLanguage);
  const nf = new Intl.NumberFormat(user.uiLanguage);

  const [userCount, invitedUserCount, onlineUserCount, bookCount, chapterCount, exerciseCount, newFeedback, emailSettings, switcher] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { registeredViaInvite: true } }),
    prisma.user.count({ where: { isAdmin: false, onlineSocketCount: { gt: 0 } } }),
    prisma.book.count(),
    prisma.chapter.count(),
    prisma.exercise.count(),
    prisma.feedback.count({ where: { status: "NEW" } }),
    getEmailSettingsView(),
    getContentSwitcherSettings(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <AdminPageHeader
        title={t("adminPage.title")}
        text={t("adminPage.subtitle")}
        aside={
          <p className="shrink-0 text-xs font-medium leading-relaxed text-vs-fg-3 sm:text-right">
            v{packageJson.version} · beta
            <br />
            build {process.env.NEXT_PUBLIC_BUILD_SHA?.slice(0, 7) ?? t("adminPage.unknown")}
          </p>
        }
      />

      <ul aria-label={t("adminHub.overviewLabel")} className="grid gap-3 sm:grid-cols-2">
        <li>
          <AdminCategoryCard
            href="/adminbackend/gebruikers"
            icon={Users}
            title={t("adminHub.usersTitle")}
            description={t("adminHub.usersText")}
            stats={[
              { label: t("adminHub.usersCount"), value: nf.format(userCount) },
              { label: t("adminHub.online"), value: nf.format(onlineUserCount) },
              { label: t("adminHub.viaInvite"), value: nf.format(invitedUserCount) },
            ]}
          />
        </li>
        <li>
          <AdminCategoryCard
            href="/adminbackend/content"
            icon={BookOpenCheck}
            title={t("adminHub.contentTitle")}
            description={t("adminHub.contentText")}
            stats={[
              { label: t("adminHub.books"), value: nf.format(bookCount) },
              { label: t("adminHub.chapters"), value: nf.format(chapterCount) },
              { label: t("adminHub.exercises"), value: nf.format(exerciseCount) },
              { label: switcher.enabled ? t("adminHub.switcherOn") : t("adminHub.switcherOff"), value: switcher.enabled ? "✓" : "–" },
            ]}
          />
        </li>
        <li>
          <AdminCategoryCard href="/adminbackend/spellen" icon={Gamepad2} title={t("adminHub.gamesTitle")} description={t("adminHub.gamesText")} />
        </li>
        <li>
          <AdminCategoryCard
            href="/adminbackend/communicatie"
            icon={MessageSquare}
            title={t("adminHub.commsTitle")}
            description={t("adminHub.commsText")}
            attention={newFeedback > 0 ? t("adminHub.newFeedback", { n: nf.format(newFeedback) }) : undefined}
            stats={[{ label: emailSettings.enabled ? t("adminHub.emailOn") : t("adminHub.emailOff"), value: emailSettings.enabled ? "✓" : "–" }]}
          />
        </li>
        <li className="sm:col-span-2">
          <AdminCategoryCard
            href="/adminbackend/systeem"
            icon={Server}
            title={t("adminHub.systemTitle")}
            description={t("adminHub.systemText")}
            stats={[{ label: isDeployAgentConfigured() ? t("adminHub.deployLinked") : t("adminHub.deployNotLinked"), value: isDeployAgentConfigured() ? "✓" : "–" }]}
          />
        </li>
      </ul>

      <p className="text-xs text-vs-fg-3">{t("adminHub.dangerNote")}</p>
    </div>
  );
}
