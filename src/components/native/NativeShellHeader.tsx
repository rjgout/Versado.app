"use client";
/* eslint-disable @next/next/no-img-element -- Alleen lokaal verpakte native merkasset. */

import { useEffect, type ReactNode } from "react";
import ContentSwitcherView from "@/components/content/ContentSwitcherView";
import AppShellHeader from "@/components/shell/AppShellHeader";
import HeaderAvatarView from "@/components/shell/HeaderAvatarView";
import UserBadgesView from "@/components/shell/UserBadgesView";
import UserAvatarView from "@/components/versado/UserAvatarView";
import { EMPTY_AVATAR_APPEARANCE } from "@/lib/avatarTypes";
import { useNativeData, useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { NativeClientError } from "@/lib/native/client";
import type { NativeAccount, NativeContentState } from "@/lib/native/contract";
import { NATIVE_PRIMARY_NAV } from "@/lib/native/shell";

/** Alleen de native data-/assetadapter; alle zichtbare shell-JSX is gedeeld. */
export default function NativeShellHeader({ account, onError, content, buildIndicator }: { account: NativeAccount | null; onError: (error: unknown) => void; content?: NativeContentState; buildIndicator?: ReactNode }) {
  const runtime = useNativeData();
  const query = useNativeLiveQuery<NativeAccount>(["shell-account", account?.id ?? null], async () => {
    const value = await runtime.account();
    if (value.id !== account?.id) throw new NativeClientError("session_changed", 409);
    return value;
  }, { scopes: ["xp", "streak", "profile", "competition"], enabled: !!account, initialData: account ?? undefined, staleTime: 60_000, pollMs: 60_000 });
  const { setData } = query;
  const epoch = runtime.getSnapshot();
  // Een bevestigde bootstrap is net als web-SSR een actuele serverwaarde.
  useEffect(() => { if (account && runtime.getSnapshot() === epoch) setData(account); }, [account, setData, runtime, epoch]);
  useEffect(() => { if (query.error && runtime.getSnapshot() === epoch) onError(query.error); }, [query.error, onError, runtime, epoch]);
  const current = account && query.data?.id === account.id ? query.data : account;
  const header = current?.shellHeader;
  const active = content?.userId === current?.id ? content?.picker.works.flatMap(work => work.editions).find(edition => edition.id === content.picker.activeCollectionId) : undefined;
  const showSwitcher = !!active && !!content?.switcherEnabled;
  return <AppShellHeader authenticated={!!current} homeHref={current ? "/dashboard" : "/login"} showBrandOnMobile={!showSwitcher} destinations={NATIVE_PRIMARY_NAV}
    brand={<><img src="/icons/native/versado-flame.png" width="44" height="44" alt="" /><span>Versado</span></>}
    contextLabel={buildIndicator}
    leading={active && <ContentSwitcherView active={active} enabled={content!.switcherEnabled} showLanguage onNavigate={() => {}} />}
    status={header && <UserBadgesView streak={header.streak} xp={header.xp} studiedToday={header.studiedToday} tier={header.tier} interactive={false} />}
    profile={current && <HeaderAvatarView avatar={<UserAvatarView id={current.id} handle={current.handle} appearance={header?.avatar ?? EMPTY_AVATAR_APPEARANCE} size="sm" />} />}
  />;
}
