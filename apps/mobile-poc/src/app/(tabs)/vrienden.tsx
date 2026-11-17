import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useAppSession } from "@poc/core/AppSessionProvider";
import { acceptFriend, ActionGate, loadFriends } from "@poc/core/friends";
import { useLive } from "@poc/core/useLive";

export default function Vrienden() {
  const { session } = useAppSession();
  const gate = useRef(new ActionGate()).current;
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const subscribe = useMemo(() => (refresh: () => void) => session.onFriendsChanged(refresh), [session]);
  const { data, error, loading, refresh } = useLive(useCallback((signal: AbortSignal) => loadFriends(session.gameFetch, signal), [session]), subscribe);

  const accept = (friendshipId: string) => {
    setActionError(null); setBusy(b => ({ ...b, [friendshipId]: true }));
    gate.run(friendshipId, () => acceptFriend(session.gameFetch, friendshipId))
      .then(() => refresh())
      .catch(() => setActionError("Accepteren mislukt. Probeer het opnieuw."))
      .finally(() => setBusy(b => { const { [friendshipId]: _, ...rest } = b; return rest; }));
  };
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refresh} />} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "700" }}>Vrienden</Text>
      {loading && !data ? <ActivityIndicator accessibilityLabel="Laden" /> : null}
      {error && !data ? <Pressable accessibilityRole="button" onPress={refresh}><Text style={{ color: "#b00020" }}>Laden mislukt. Tik om opnieuw te proberen.</Text></Pressable> : null}
      {actionError ? <Text accessibilityRole="alert" style={{ color: "#b00020" }}>{actionError}</Text> : null}
      {data && data.incoming.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "600" }}>Verzoeken</Text>
          {data.incoming.map(r => (
            <View key={r.friendshipId} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 }}>
              <Text style={{ flexShrink: 1 }}>{r.from.handle}#{r.from.discriminator}</Text>
              <Pressable testID={`accept-${r.friendshipId}`} accessibilityRole="button" accessibilityLabel={`Verzoek van ${r.from.handle} accepteren`} accessibilityState={{ disabled: !!busy[r.friendshipId], busy: !!busy[r.friendshipId] }} disabled={!!busy[r.friendshipId]} onPress={() => accept(r.friendshipId)} style={{ backgroundColor: "#1d4ed8", paddingHorizontal: 16, borderRadius: 10, justifyContent: "center", minHeight: 44, opacity: busy[r.friendshipId] ? 0.6 : 1 }}>
                <Text style={{ color: "white", fontWeight: "600" }}>{busy[r.friendshipId] ? "Bezig…" : "Accepteren"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {data ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "600" }}>Vrienden ({data.friends.length})</Text>
          {data.friends.length === 0 ? <Text style={{ opacity: 0.6 }}>Nog geen vrienden.</Text> : null}
          {data.friends.map(f => <View key={f.friendshipId} style={{ borderWidth: 1, borderRadius: 12, padding: 12 }}><Text>{f.user.handle}#{f.user.discriminator}</Text></View>)}
        </View>
      ) : null}
    </ScrollView>
  );
}
