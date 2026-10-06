import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatElapsedDutch } from "@/lib/dates";
import { getEmailSettingsView } from "@/lib/email";
import { getLeagueSettings } from "@/lib/leagues";
import AdminUsersClient from "@/components/AdminUsersClient";
import EmailSettingsClient from "@/components/EmailSettingsClient";
import ReseedClient from "@/components/ReseedClient";
import FeedbackAdminClient from "@/components/FeedbackAdminClient";
import AdminChangelogClient from "@/components/AdminChangelogClient";
import AdminLiveGamesClient from "@/components/AdminLiveGamesClient";
import AdminGameSettingsClient from "@/components/AdminGameSettingsClient";
import AdminCoursesClient from "@/components/AdminCoursesClient";
import AdminBrandingClient from "@/components/AdminBrandingClient";
import AdminLeagueSettingsClient from "@/components/AdminLeagueSettingsClient";
import AdminDeployClient from "@/components/AdminDeployClient";
import AdminContentSwitcherClient from "@/components/AdminContentSwitcherClient";
import AdminFsyClient from "@/components/AdminFsyClient";
import AdminAlleskennerClient from "@/components/AdminAlleskennerClient";
import { isDeployAgentConfigured } from "@/lib/deployAgent";
import packageJson from "../../../package.json";
import { getT } from "@/lib/i18n";
import { translateServerText } from "@/lib/i18n/serverTexts";

export default async function AdminBackendPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");
  const t = getT(user.uiLanguage);

  const [users, userCount, bookCount, chapterCount, exerciseCount, emailSettings, leagueSettings, onlineUserCount, invitedUserCount] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        handle: true,
        discriminator: true,
        isAdmin: true,
        xpTotal: true,
        currentStreak: true,
        freezeCount: true,
        onlineSocketCount: true,
        lastSeenAt: true,
        createdAt: true,
      },
    }),
    prisma.user.count(),
    prisma.book.count(),
    prisma.chapter.count(),
    prisma.exercise.count(),
    getEmailSettingsView(),
    getLeagueSettings(prisma),
    prisma.user.count({
      where: {
        isAdmin: false,
        onlineSocketCount: { gt: 0 },
      },
    }),
    prisma.user.count({ where: { registeredViaInvite: true } }),
  ]);

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-8">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("adminPage.title")}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t("adminPage.subtitle")}</p>
          </div>
          <div className="text-right text-xs text-slate-400 dark:text-slate-500 shrink-0">
            <div>v{packageJson.version} · beta</div>
            <div>build {process.env.NEXT_PUBLIC_BUILD_SHA?.slice(0, 7) ?? t("adminPage.unknown")}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label={t("adminPage.users")} value={userCount} />
        <StatCard label={t("adminPage.viaInvite")} value={invitedUserCount} />
        <StatCard label={t("adminPage.books")} value={bookCount} />
        <StatCard label={t("adminPage.chapters")} value={chapterCount} />
        <StatCard label={t("adminPage.exercises")} value={exerciseCount} className="col-span-2 sm:col-span-1" />
      </div>

      <Link href="/adminbackend/content-preview" className="card flex items-center justify-between gap-4 transition hover:border-brand-300 dark:hover:border-brand-700">
        <div>
          <h2 className="font-extrabold text-brand-800 dark:text-brand-300">OTB-schriftpreview</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Bekijk verborgen proefhoofdstukken als alleen-lezenbeheerder.</p>
        </div>
        <span className="text-sm font-bold text-vs-accent">Openen →</span>
      </Link>

      <AdminDeployClient configured={isDeployAgentConfigured()} onlineUserCount={onlineUserCount} />

      <ReseedClient />

      <AdminUsersClient
        initialUsers={users.map(({ onlineSocketCount, lastSeenAt, ...u }) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          online: onlineSocketCount > 0,
          lastSeenLabel: onlineSocketCount > 0 ? null : lastSeenAt ? translateServerText(formatElapsedDutch(lastSeenAt), t) : t("adminPage.never"),
        }))}
        currentUserId={user.id}
      />

      <EmailSettingsClient initial={emailSettings} />

      <AdminLeagueSettingsClient initial={{ ...leagueSettings, activityRules: JSON.stringify(leagueSettings.activityRules, null, 2) }} />

      <AdminBrandingClient />

      <AdminContentSwitcherClient />

      <AdminFsyClient />

      <FeedbackAdminClient />

      <AdminLiveGamesClient />

      <AdminGameSettingsClient />

      <AdminAlleskennerClient />

      <AdminCoursesClient />

      <AdminChangelogClient />
    </div>
  );
}

function StatCard({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className={`card text-center py-4 ${className}`}>
      <div className="text-2xl font-extrabold text-brand-700 dark:text-brand-300">{value}</div>
      <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{label}</div>
    </div>
  );
}
