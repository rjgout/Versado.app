import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type ContentActor = { isAdmin: boolean };
export type ContentAccessPurpose = "catalog" | "read" | "admin-preview";
export type LegacyContentAccess = { enabled: boolean; visibleToUsers: boolean };

/**
 * Eén toegangspoort op het bestaande schema. Publicatiecompatibiliteit en
 * ContentWork-DDL blijven geblokkeerd totdat inventaris/herstel bewezen zijn.
 * De actor komt uitsluitend uit de serverauthenticatie, nooit uit een payload.
 */
export function collectionAccessWhere(
  actor: ContentActor | null,
  purpose: ContentAccessPurpose = "read",
): Prisma.ContentCollectionWhereInput {
  if (!actor || (purpose === "admin-preview" && !actor.isAdmin)) return { id: { in: [] } };
  if (purpose === "admin-preview") return {};
  return { enabled: true, ...(purpose === "catalog" && actor.isAdmin ? {} : { visibleToUsers: true }) };
}

export function canAccessLegacyCollection(
  actor: ContentActor | null,
  collection: LegacyContentAccess | null,
  purpose: ContentAccessPurpose = "read",
): boolean {
  if (!actor || !collection) return false;
  if (purpose === "admin-preview") return actor.isAdmin;
  return collection.enabled && (collection.visibleToUsers || (purpose === "catalog" && actor.isAdmin));
}

/** De bestaande beheerpreview vereist een door de server vastgestelde adminrol. */
export function readingAccessWhere(actor: ContentActor): Prisma.ContentCollectionWhereInput {
  return collectionAccessWhere(actor, actor.isAdmin ? "admin-preview" : "read");
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
    select: { enabled: true, visibleToUsers: true },
  });
  return canAccessLegacyCollection(actor, collection, purpose);
}
