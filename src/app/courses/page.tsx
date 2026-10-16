import Link from "next/link";
import PageIntro from "@/components/versado/PageIntro";
import LiveRefresh from "@/components/LiveRefresh";
import { getStudyCatalogue } from "@/lib/studyContent/catalogue";
import { getT } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import CoursesClient from "@/components/CoursesClient";

export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { lessons, token } = await getStudyCatalogue(user);
  if (lessons.length) {
    const t = getT(user.uiLanguage);
    return (
      <div
        data-study-catalogue
        className="mx-auto flex min-w-0 max-w-3xl flex-col gap-4 pb-6"
      >
        <LiveRefresh
          scopes={["content", "studyContent"]}
          token={token}
          staleTime={0}
        />
        <PageIntro title={t("managedContent.lessons")} />
        <ol className="grid min-w-0 gap-3">
          {lessons.map((l) => (
            <li key={l.id}>
              <Link
                data-study-lesson={l.id}
                prefetch={false}
                href={`/study-lesson/${encodeURIComponent(l.lessonId)}/${encodeURIComponent(l.collectionId)}`}
                className="flex min-h-14 flex-col gap-1 rounded-2xl border border-vs-line bg-vs-surface p-4 font-bold text-vs-fg hover:bg-vs-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-vs-accent"
              >
                <span>{l.publishedRevision?.title}</span>
                <span className="text-sm font-normal text-vs-fg-3">
                  {l.lesson.startsOn?.toISOString().slice(0, 10)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return <CoursesClient />;
}
