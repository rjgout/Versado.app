import { prisma } from "@/lib/db";
import { getContentPickerContext, getContentSwitcherSettings, commitContentSelection, ContentSelectionConflict } from "@/lib/contentCollections";
import { applyContentSwitch } from "@/lib/contentSwitch";
import { readingAccessWhere } from "@/lib/contentAccess";
import { activeNativeSession, lockNativeUser, NativeAuthError, type NativeSessionBinding } from "./sessions";
import { nativeContentStateSchema, type NativeContentSelection } from "./contract";
import { nativeRoute } from "./navigation";

export async function getNativeContentState(user: { id: string; isAdmin: boolean }) {
  const [picker, settings] = await Promise.all([getContentPickerContext(user.id), getContentSwitcherSettings()]);
  return nativeContentStateSchema.parse({ version: 1, userId: user.id, picker, switcherEnabled: user.isAdmin || settings.enabled && (picker.works.flatMap(work => work.editions).length > 1 || !!picker.hymnsAvailable) });
}

/** Bestaande catalogus/resolver/selectie, met dezelfde User → NativeSession-lockvolgorde. */
export async function selectNativeContent(binding: NativeSessionBinding, input: NativeContentSelection) {
  const user = await activeNativeSession(binding);
  if (input.location.startsWith("/lesson/")) {
    const readable = await prisma.chapter.count({ where: { id: input.location.slice(8), book: { contentCollection: readingAccessWhere(user) } } });
    if (!readable) throw new NativeAuthError("content_unavailable", 404);
  }
  let result;
  try {
    result = await applyContentSwitch({ userId: user.id, isAdmin: user.isAdmin, picker: true,
      change: { contentCollectionId: input.contentCollectionId }, expectedSelection: input.expectedSelection,
      location: { pathname: input.location, search: "" },
      commitSelection: (target, expected) => prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
        await lockNativeUser(tx, binding.userId);
        await tx.$queryRaw`SELECT "id" FROM "NativeSession" WHERE "id"=${binding.sessionId}::uuid FOR UPDATE`;
        const current = await activeNativeSession(binding, tx);
        const saved = await commitContentSelection(current.id, current.isAdmin, target, expected, { db: tx, expectedVersion: input.expectedSelectionVersion });
        // Rijlocks serialiseren intrekking; ook verloop tijdens lockwachten/commitwerk weigeren.
        await activeNativeSession(binding, tx);
        return saved;
      }, { maxWait: 2000, timeout: 5000 }),
    });
  } catch (error) {
    if (error instanceof ContentSelectionConflict || error instanceof NativeAuthError) throw error;
    if (error instanceof Error && ["Uitgave niet beschikbaar", "Content niet beschikbaar"].includes(error.message)) throw new NativeAuthError("content_unavailable", 404);
    throw error;
  }
  if (!result.applied || result.outcome.kind !== "redirect") throw new NativeAuthError("content_unavailable", 404);
  const current = await activeNativeSession(binding), state = await getNativeContentState(current);
  if (state.picker.selectionVersion !== result.selectionVersion) throw new ContentSelectionConflict(state.picker.selection);
  return { state, destination: nativeRoute(result.outcome.href) ?? "/content", changed: result.changed ?? false };
}
