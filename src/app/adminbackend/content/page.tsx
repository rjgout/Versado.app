import Link from "next/link";
import { ChevronRight } from "lucide-react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminContentSwitcherClient from "@/components/AdminContentSwitcherClient";
import AdminCoursesClient from "@/components/AdminCoursesClient";
import AdminFsyClient from "@/components/AdminFsyClient";
import { interactiveCard } from "@/components/versado/styles";
import { requireAdminPage } from "@/lib/adminGuard";
import { getT } from "@/lib/i18n";

export default async function AdminContentPage() {
  const user = await requireAdminPage();
  const t = getT(user.uiLanguage);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <AdminPageHeader title={t("adminHub.contentTitle")} text={t("adminHub.contentText")} />
      <Link href="/adminbackend/content-preview" className={`group flex min-h-16 items-center gap-3 p-4 ${interactiveCard}`}>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-extrabold text-vs-fg">{t("adminHub.previewTitle")}</span>
          <span className="block text-sm text-vs-fg-2">{t("adminHub.previewText")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-vs-accent">
          {t("adminHub.open")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </span>
      </Link>
      <AdminContentSwitcherClient />
      <AdminCoursesClient />
      <AdminFsyClient />
    </div>
  );
}
