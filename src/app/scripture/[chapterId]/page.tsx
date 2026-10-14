import { notFound, redirect } from "next/navigation";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { ReaderView } from "@/components/LessonFlow";
import FocusLayout from "@/components/versado/FocusLayout";
import ReferenceReturn from "@/components/study/ReferenceReturn";
export default async function ScripturePage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { chapterId } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(chapterId)) notFound();
  const chapter = await prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SET TRANSACTION READ ONLY`;
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      return db.chapter.findFirst({
        where: {
          id: chapterId,
          book: {
            contentCollection: {
              ...readingAccessWhere(user),
              contentWork: { kind: "SCRIPTURE" },
            },
          },
        },
        select: {
          id: true,
          number: true,
          book: {
            select: {
              name: true,
              contentCollection: {
                select: { name: true, language: true, editionKey: true },
              },
            },
          },
          verses: {
            orderBy: { number: "asc" },
            take: 501,
            select: { id: true, number: true, text: true },
          },
        },
      });
    },
    { timeout: 10000 },
  );
  if (
    !chapter ||
    !chapter.verses.length ||
    chapter.verses.length > 500 ||
    Buffer.byteLength(JSON.stringify(chapter)) > 500000
  )
    notFound();
  return (
    <FocusLayout>
      <div className="space-y-5 py-2" data-scripture-readonly>
        <ReferenceReturn sessionKey={await navigationSessionKey()} />
        <p className="text-sm text-vs-fg-2">
          {chapter.book.contentCollection.name} ·{" "}
          {chapter.book.contentCollection.language} ·{" "}
          {chapter.book.contentCollection.editionKey}
        </p>
        <ReaderView
          chapterId={chapter.id}
          bookName={chapter.book.name}
          chapterNumber={chapter.number}
          language={chapter.book.contentCollection.language}
          verses={chapter.verses.map((v) => ({
            ...v,
            bookmarked: false,
            highlighted: false,
            note: "",
            audioStart: null,
          }))}
          preview
          focus
        />
      </div>
    </FocusLayout>
  );
}
