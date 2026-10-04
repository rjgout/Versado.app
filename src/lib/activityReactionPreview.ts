export interface PreviewReaction {
  userId: string;
  createdAt: Date;
  id: string;
}

/** Vrienden eerst, maar binnen beide groepen altijd de oudste reactie eerst. */
export function selectReactionPreview<T extends PreviewReaction>(reactions: T[], friendIds: ReadonlySet<string>, limit = 5): T[] {
  return [...reactions]
    .sort((a, b) => {
      const friendOrder = Number(!friendIds.has(a.userId)) - Number(!friendIds.has(b.userId));
      return friendOrder || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export function otherReactionCount(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
