import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

// Voor het "tik op een naam"-kaartje in de introductiecursus
// (PersonCard.tsx, ook geneste vader-/kinderkaartjes) — leest de tot nu toe
// ongebruikte Person-tabel (zie het schemacommentaar bij Person in
// schema.prisma).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { slug } = await params;
  const person = await prisma.person.findFirst({
    where: { slug, contentCollection: readingAccessWhere(user) },
    include: {
      father: { where: { contentCollection: readingAccessWhere(user) }, select: { slug: true, name: true } },
      children: { where: { contentCollection: readingAccessWhere(user) }, select: { slug: true, name: true } },
    },
  });
  if (!person) return await apiError("apiErrors.personNotFound", 404);

  return NextResponse.json({
    slug: person.slug,
    name: person.name,
    description: person.description,
    father: person.father,
    children: person.children,
  });
}
