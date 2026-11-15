import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { useAppSession } from "@poc/core/AppSessionProvider";

export default function Login() {
  const { signIn, phase } = useAppSession();
  const [id, setId] = useState(""), [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  if (phase === "signedIn") return <Redirect href="/vandaag" />;
  const submit = async () => {
    if (busy) return; // dubbel tikken
    setBusy(true); setError(null);
    try { await signIn(id.trim(), pw); }
    catch (e) {
      const base = e instanceof Error && /wrong|credentials|401/.test(e.message) ? "Onjuiste gegevens." : "Inloggen mislukt. Probeer het opnieuw.";
      // Alleen in de runtime-testbuilds: de oorzaak zichtbaar maken voor de UI-dump (nooit in een gewone build).
      const detail = process.env.EXPO_PUBLIC_POC_DEBUG === "1" && e instanceof Error ? ` [${e.name}: ${e.message}]` : "";
      setError(base + detail);
    }
    finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "700" }}>Inloggen</Text>
      <TextInput testID="login-id" accessibilityLabel="E-mailadres of gebruikersnaam" autoCapitalize="none" autoComplete="username" keyboardType="email-address" value={id} onChangeText={setId} style={{ borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48 }} />
      <TextInput testID="login-password" accessibilityLabel="Wachtwoord" secureTextEntry autoComplete="current-password" value={pw} onChangeText={setPw} onSubmitEditing={submit} style={{ borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48 }} />
      {error ? <Text accessibilityRole="alert" style={{ color: "#b00020" }}>{error}</Text> : null}
      <Pressable testID="login-submit" accessibilityRole="button" accessibilityLabel="Inloggen" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={submit} style={{ backgroundColor: "#1d4ed8", padding: 14, borderRadius: 12, alignItems: "center", minHeight: 48, opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: "white", fontWeight: "600" }}>{busy ? "Bezig…" : "Inloggen"}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
