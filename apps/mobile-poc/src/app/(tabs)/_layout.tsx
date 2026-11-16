import { NativeTabs } from "expo-router/native-tabs";
import { Redirect } from "expo-router";
import { useAppSession } from "@poc/core/AppSessionProvider";

export default function TabsLayout() {
  const { phase, epoch } = useAppSession();
  if (phase === "signedOut") return <Redirect href="/login" />;
  // key={epoch}: bij accountwissel worden alle tabschermen opnieuw opgebouwd, dus nooit restdata van de vorige gebruiker.
  return (
    <NativeTabs key={epoch}>
      <NativeTabs.Trigger name="vandaag">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Vandaag</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="lezen">
        <NativeTabs.Trigger.Icon sf="book.fill" md="menu_book" />
        <NativeTabs.Trigger.Label>Lezen</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vrienden">
        <NativeTabs.Trigger.Icon sf="person.2.fill" md="group" />
        <NativeTabs.Trigger.Label>Vrienden</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
