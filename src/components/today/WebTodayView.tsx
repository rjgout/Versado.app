"use client";
import type { ComponentProps } from "react";
import { liveMutation } from "@/lib/data/mutation";
import { hideListItem } from "@/lib/listOrder";
import UserAvatar from "@/components/UserAvatar";
import FriendRequestButtons from "./FriendRequestButtons";
import SocialLive from "./SocialLive";
import TodayView from "./TodayView";
import { TodayInteractionsProvider, type TodayInteractions } from "./TodayInteractions";
const interactions: TodayInteractions = {
  Avatar: UserAvatar, FriendActions: FriendRequestButtons, Social: SocialLive,
  hideContinue: item => liveMutation(() => hideListItem("today-continue", item.visibilityKey), { invalidates: ["today"] }),
};
export default function WebTodayView(props: ComponentProps<typeof TodayView>) {
  return <TodayInteractionsProvider value={interactions}><TodayView {...props}/></TodayInteractionsProvider>;
}
