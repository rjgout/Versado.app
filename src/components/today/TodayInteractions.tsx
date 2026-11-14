"use client";
import { createContext, useContext, type ComponentProps, type ComponentType, type ReactNode } from "react";
import type UserAvatarView from "@/components/UserAvatar";
import type { TodayData } from "@/lib/today";
import type { ContinueItem } from "@/lib/today";
export type FriendActionProps = { friendshipId: string; otherUserId: string; name: string };
export type TodayInteractions = {
  hideContinue(item: ContinueItem): Promise<void>;
  respondFriend?: (friendshipId: string, action: "accept" | "decline") => Promise<void>;
  FriendActions: ComponentType<FriendActionProps>;
  Social: ComponentType<{ social: TodayData["social"] }>;
  Avatar: ComponentType<ComponentProps<typeof UserAvatarView>>;
};
const Context = createContext<TodayInteractions | null>(null);
export function TodayInteractionsProvider({ value, children }: { value: TodayInteractions; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTodayInteractions() {
  const value = useContext(Context);
  if (!value) throw new Error("TodayInteractionsProvider ontbreekt");
  return value;
}
export function TodayAvatar(props: ComponentProps<typeof UserAvatarView>) { const { Avatar } = useTodayInteractions(); return <Avatar {...props}/>; }
export function TodayFriendActions(props: FriendActionProps) { const { FriendActions } = useTodayInteractions(); return <FriendActions {...props}/>; }
export function TodaySocial({ social }: { social: TodayData["social"] }) { const { Social } = useTodayInteractions(); return <Social social={social}/>; }
