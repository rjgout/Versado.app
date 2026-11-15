import { useCallback } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useAppSession } from "@poc/core/AppSessionProvider";
import { useLive } from "@poc/core/useLive";

export default function Vandaag() {
  const { session, signOut } = useAppSession();
  const { data, error, loading, refresh } = useLive(useCallback(() => session.today(), [session]));
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refresh} />} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "700" }}>Vandaag</Text>
      {loading && !data ? <ActivityIndicator accessibilityLabel="Laden" /> : null}
      {error && !data ? <Pressable accessibilityRole="button" onPress={refresh}><Text style={{ color: "#b00020" }}>Laden mislukt. Tik om opnieuw te proberen.</Text></Pressable> : null}
      {data ? (
        <View testID="vandaag-streak" accessible accessibilityLabel={`Reeks ${data.continuation.currentStreak} dagen`} style={{ borderWidth: 1, borderRadius: 14, padding: 16, gap: 4 }}>
          <Text style={{ fontSize: 17, fontWeight: "600" }}>Reeks: {data.continuation.currentStreak} {data.continuation.currentStreak === 1 ? "dag" : "dagen"}</Text>
          <Text>{data.continuation.studiedToday ? "Vandaag gestudeerd" : "Vandaag nog niet gestudeerd"}</Text>
          <Text style={{ opacity: 0.6 }}>Bron: {data.activeCollectionId} · taal {data.language}</Text>
        </View>
      ) : null}
      <Pressable testID="logout-button" accessibilityRole="button" accessibilityLabel="Uitloggen" onPress={() => void signOut()} style={{ padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center", minHeight: 48 }}>
        <Text>Uitloggen</Text>
      </Pressable>
    </ScrollView>
  );
}
