import { Redirect } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useAppSession } from "@poc/core/AppSessionProvider";

export default function Index() {
  const { phase, retry } = useAppSession();
  if (phase === "offline") return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "700" }}>Geen verbinding</Text>
      <Text>Versado kan de server nu niet bereiken. Je blijft ingelogd; we proberen het zo opnieuw.</Text>
      <Pressable testID="retry-connection" accessibilityRole="button" accessibilityLabel="Opnieuw proberen" onPress={retry} style={{ minHeight: 44, borderRadius: 10, borderWidth: 1, justifyContent: "center", paddingHorizontal: 14 }}><Text>Opnieuw proberen</Text></Pressable>
    </View>
  );
  if (phase === "booting") return <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator accessibilityLabel="Laden" /></View>;
  return <Redirect href={phase === "signedIn" ? "/vandaag" : "/login"} />;
}
