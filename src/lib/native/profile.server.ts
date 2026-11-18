import { commitAccountMutation } from "@/lib/account/mutation";
import { logoutAccount } from "@/lib/account/logout";
import { getContentContext } from "@/lib/contentCollections";
import { saveFeaturedAchievements } from "@/lib/featuredAchievements";
import { loadProfileChangelog,markProfileChangelogSeen } from "@/lib/profile/changelog";
import { loadProfile } from "@/lib/profile/load";
import { setPodcastNotification } from "@/lib/profile/podcastNotifications";
import { resetProfileReading } from "@/lib/profile/readingReset";
import { patchProfileSettings,ProfileSettingsError } from "@/lib/profile/settings";
import { nativeProfileSchema,type NativeProfileAction } from "./profileContract";
import { activeNativeSession,NativeAuthError,type NativeSessionBinding } from "./sessions";

export async function getNativeProfile(binding: NativeSessionBinding) {
  const user = await activeNativeSession(binding);
  const profile = await loadProfile(user, { userId:user.id, nativeSession:binding });
  const context = await getContentContext(user.id), changelog = await loadProfileChangelog();
  await activeNativeSession(binding);
  return nativeProfileSchema.parse({ version:1, userId:user.id, profile, contentLanguage:context.contentLanguage, contentLanguages:context.contentLanguages, changelog });
}
export async function mutateNativeProfile(binding: NativeSessionBinding, action: NativeProfileAction) {
  const actor = { userId:binding.userId, nativeSession:binding };
  if (action.kind === "logout-all") await logoutAccount({id:binding.userId,sessionVersion:binding.sessionVersion},binding);
  else if (action.kind === "settings") await patchProfileSettings(actor, action.patch);
  else await commitAccountMutation(actor, [], async tx => {
    if (action.kind === "featured-achievements") {
      try { await saveFeaturedAchievements(actor.userId, action.achievementIds, tx); }
      catch (error) { if (error instanceof Error && error.message === "INVALID_FEATURED_ACHIEVEMENTS") throw new NativeAuthError("invalid_input",400); throw error; }
    } else if(action.kind === "changelog-seen") await markProfileChangelogSeen(tx,actor.userId);
    else if (action.kind === "reading-reset") await resetProfileReading(tx, actor.userId);
    else if (!await setPodcastNotification(tx, actor.userId, action.podcastId, action.enabled)) throw new NativeAuthError("content_unavailable",404);
  });
  return { version:1 as const, userId:binding.userId, ok:true as const };
}
export { ProfileSettingsError };
