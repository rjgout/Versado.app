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

/**
 * Selecteert reageerders voor de compacte feedregel. Een persoon krijgt maar
 * één plek; de eerste reactie van die persoon bepaalt zijn chronologische
 * positie. De vriendenvoorrang blijft daarna hetzelfde als bij de oude
 * reactiepreview.
 */
export function selectReactionerPreview<T extends PreviewReaction>(reactions: T[], friendIds: ReadonlySet<string>, limit = 3): T[] {
  const firstByUser = new Map<string, T>();
  for (const reaction of [...reactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))) {
    if (!firstByUser.has(reaction.userId)) firstByUser.set(reaction.userId, reaction);
  }
  return selectReactionPreview([...firstByUser.values()], friendIds, limit);
}

export function otherReactionCount(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
