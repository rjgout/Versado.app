"use client";
import { useCallback, useMemo } from "react";
import { AppNavigationProvider, useAppNavigationAdapter, type AppLinkProps } from "@/components/navigation/AppNavigation";
import { ConfirmProvider, useConfirm } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import { CompanionProvider } from "@/components/versado/PersonalMascot";
import UserAvatarView from "@/components/versado/UserAvatarView";
import { EMPTY_AVATAR_APPEARANCE } from "@/lib/avatarTypes";
import TodayView from "@/components/today/TodayView";
import SocialView from "@/components/today/SocialView";
import TodayProgramView from "@/components/today/TodayProgramView";
import StreakContinuationCardView from "@/components/today/StreakContinuationCardView";
import FriendRequestControl from "@/components/today/FriendRequestControl";
import KompasEntryCardView from "@/components/kompas/KompasEntryCardView";
import { TodayInteractionsProvider, type TodayInteractions, useTodayInteractions } from "@/components/today/TodayInteractions";
import { nativeTodayDestination } from "@/lib/native/todayDestinations";
import { nativeTodayImageSource } from "@/lib/native/todayAssets";
import type { NativeTodayOverview } from "@/lib/native/todayContract";

type Actions = { hideContinue: TodayInteractions["hideContinue"]; respondFriend: NonNullable<TodayInteractions["respondFriend"]> };
function NativeFriendActions({ friendshipId, name }: { friendshipId: string; name: string }) {
  const { respondFriend } = useTodayInteractions();
  return <FriendRequestControl name={name} respond={action => respondFriend!(friendshipId, action)}/>;
}
export default function NativeTodayView({ state, actions }: { state: NativeTodayOverview; actions?: Actions }) {
  return <ConfirmProvider><NativeTodayContent state={state} actions={actions}/></ConfirmProvider>;
}
function NativeTodayContent({ state, actions }: { state: NativeTodayOverview; actions?: Actions }) {
  const navigation = useAppNavigationAdapter(), t = useT();
  const confirm = useConfirm();
  const notify = useCallback(() => { void confirm(t("nativeToday.unavailable"), { native: true, notice: true, title: t("nav.today"), confirmLabel: t("common.close") }); }, [confirm, t]);
  const adapter = useMemo(() => {
    function TodayLink({ href, ...props }: AppLinkProps) {
      const target = nativeTodayDestination(href);
      if (target.href) { const Link = navigation.Link; return <Link {...props} href={target.href}/>; }
      const { replace, prefetch, onNavigate, ...anchor } = props; void replace; void prefetch; void onNavigate;
      return <a {...anchor} role="button" tabIndex={props.tabIndex ?? 0} data-native-unavailable-href={href} aria-describedby="native-today-destinations" onClick={event => { event.preventDefault(); notify(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); notify(); } }}/>;
    }
    // The supported links use the parent adapter, not a recursively nested AppLink.
    return { ...navigation, Link: TodayLink, imageSource: nativeTodayImageSource };
  }, [navigation, notify]);
  const interactions = useMemo<TodayInteractions>(() => ({
    Avatar: ({ avatarEmoji, ...props }) => { void avatarEmoji; return <UserAvatarView {...props} appearance={state.avatars[props.id] ?? EMPTY_AVATAR_APPEARANCE}/>; },
    Social: SocialView,
    FriendActions: NativeFriendActions,
    respondFriend: actions?.respondFriend ?? (async () => { notify(); throw new Error("native_action_unavailable"); }),
    hideContinue: actions?.hideContinue ?? (async () => { notify(); throw new Error("native_action_unavailable"); }),
  }), [state.avatars, notify, actions]);
  return <CompanionProvider character={state.companion}><TodayInteractionsProvider value={interactions}>
    <p id="native-today-destinations" className="sr-only">{t("nativeToday.unavailable")}</p>
    <AppNavigationProvider adapter={adapter}><TodayView data={state.data} language={state.language} serverNow={state.serverNow} countdownEnabled={state.countdownEnabled}
      before={<><StreakContinuationCardView value={state.continuation}/><TodayProgramView program={state.program}/><KompasEntryCardView isNew={state.kompasNew}/></>} /></AppNavigationProvider>
  </TodayInteractionsProvider></CompanionProvider>;
}
