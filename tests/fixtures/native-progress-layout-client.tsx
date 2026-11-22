// De echte gedeelde shell en native voortgangspresentatie; alleen HTTP-gegevens en OS-voorkeuren zijn testfixtures.
import {createRoot} from "react-dom/client";
/* eslint-disable @next/next/no-img-element -- Statische lokale browserfixture, zonder Next-imageoptimalisatieserver. */
import {I18nProvider,useT} from "../../src/components/I18nProvider";
import {messagesFor} from "../../src/lib/i18n";
import {toLanguageCode} from "../../src/lib/languages";
import {useAppNavigation} from "../../src/components/navigation/AppNavigation";
import NativeNavigationProvider from "../../src/components/native/NativeNavigationProvider";
import NativeProgressView,{nativeProgressRoute} from "../../src/components/native/NativeProgressView";
import AppShellFrame from "../../src/components/shell/AppShellFrame";
import AppShellHeader from "../../src/components/shell/AppShellHeader";
import UserBadgesView from "../../src/components/shell/UserBadgesView";
import SubpageBackBarView from "../../src/components/shell/SubpageBackBarView";
import {PRIMARY_NAV} from "../../src/lib/navigation";
import {useTestMaterial} from "./native-material-client";
const language=toLanguageCode(new URLSearchParams(location.search).get("language"));
function Scene(){
 useTestMaterial();
 const t=useT(),nav=useAppNavigation(),route=nativeProgressRoute(nav.pathname)??"/competition";
 return <AppShellFrame showNavigation destinations={PRIMARY_NAV} mainClassName="native-foundation flex min-h-dvh w-full flex-col gap-5 bg-vs-bg text-vs-fg"
 header={<AppShellHeader authenticated showBrandOnMobile homeHref="/dashboard" destinations={PRIMARY_NAV} brand={<><img src="/icons/native/versado-flame.png" width="44" height="44" alt=""/><span>Versado</span></>} status={<UserBadgesView streak={1} xp={123456} studiedToday tier="BRONZE"/>}/>}
 headerExtras={<SubpageBackBarView title={t(route==="/streak"?"header.streak":route==="/xp"?"header.xp":"nav.competition")} onBack={()=>nav.back("/dashboard")}/>}>
 <NativeProgressView userId="synthetic-layout-user" route={route} language={language} enabled/>
 </AppShellFrame>;
}
document.documentElement.lang=language;
createRoot(document.getElementById("root")!).render(<I18nProvider language={language} messages={messagesFor(language)}><NativeNavigationProvider><Scene/></NativeNavigationProvider></I18nProvider>);
