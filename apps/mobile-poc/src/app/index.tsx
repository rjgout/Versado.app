import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAppSession } from "@poc/core/AppSessionProvider";

export default function Index() {
  const { phase } = useAppSession();
  if (phase === "booting") return <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator accessibilityLabel="Laden" /></View>;
  return <Redirect href={phase === "signedIn" ? "/vandaag" : "/login"} />;
}
