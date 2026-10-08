import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminUsersClient from "@/components/AdminUsersClient";
import { requireAdminPage } from "@/lib/adminGuard";
import { prisma } from "@/lib/db";
import { formatElapsedDutch } from "@/lib/dates";
import { getT } from "@/lib/i18n";
import { translateServerText } from "@/lib/i18n/serverTexts";

export default async function AdminUsersPage() {
  const user = await requireAdminPage();
  const t = getT(user.uiLanguage);
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, handle: true, discriminator: true, isAdmin: true, xpTotal: true, currentStreak: true, freezeCount: true, onlineSocketCount: true, lastSeenAt: true, createdAt: true },
  });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <AdminPageHeader title={t("adminHub.usersTitle")} text={t("adminHub.usersText")} />
      <AdminUsersClient
        initialUsers={users.map(({ onlineSocketCount, lastSeenAt, ...u }) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          online: onlineSocketCount > 0,
          lastSeenLabel: onlineSocketCount > 0 ? null : lastSeenAt ? translateServerText(formatElapsedDutch(lastSeenAt), t) : t("adminPage.never"),
        }))}
        currentUserId={user.id}
      />
    </div>
  );
}
