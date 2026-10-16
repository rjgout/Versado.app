import type { ContentCollection, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type ContentActor = { isAdmin: boolean };
export type ContentAccessPurpose = "catalog" | "read" | "admin-preview";
type CollectionAccess = Pick<ContentCollection, "enabled" | "visibleToUsers" | "publicationState" | "work">;

/** Actor komt uit serverauthenticatie; gewone API's krijgen nooit previewrechten. */
export function collectionAccessWhere(
  actor: ContentActor | null,
  purpose: ContentAccessPurpose = "read",
): Prisma.ContentCollectionWhereInput {
  if (!actor || (purpose === "admin-preview" && !actor.isAdmin)) return { id: { in: [] } };
  // De FK valideert iedere niet-null werkidentiteit. Null blijft uitsluitend
  // voor compatibele opslag mogelijk; ongeclassificeerde inhoud wordt niet aangeboden.
  const identity = { contentWork: { isNot: null } };
  if (purpose === "admin-preview") return identity;
  return {
    ...identity, publicationState: { in: ["LEGACY", "PUBLISHED"] }, enabled: true,
    ...(actor.isAdmin ? {} : { visibleToUsers: true }),
  };
}

export function canAccessCollection(
  actor: ContentActor | null,
  collection: CollectionAccess | null,
  purpose: ContentAccessPurpose = "read",
): boolean {
  if (!actor || !collection || !collection.work) return false;
  if (purpose === "admin-preview") return actor.isAdmin;
  return ["LEGACY", "PUBLISHED"].includes(collection.publicationState)
    && collection.enabled && (collection.visibleToUsers || (actor.isAdmin));
}

/** Normale rechten: beheer mag vrijgegeven verborgen bronnen lezen, nooit DRAFT. */
export function readingAccessWhere(
  actor: ContentActor,
  purpose: "read" | "admin-preview" = "read",
): Prisma.ContentCollectionWhereInput {
  return collectionAccessWhere(actor, purpose);
}

export async function getContentAvailability(
  actor: ContentActor | null,
  collectionId: string | null,
  purpose: ContentAccessPurpose = "read",
  db: Pick<Prisma.TransactionClient, "contentCollection"> = prisma,
): Promise<boolean> {
  if (!actor || !collectionId) return false;
  const collection = await db.contentCollection.findUnique({
    where: { id: collectionId },
    select: { enabled: true, visibleToUsers: true, publicationState: true, work: true },
  });
  return canAccessCollection(actor, collection, purpose);
}
