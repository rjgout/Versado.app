import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppSessionProvider } from "@poc/core/AppSessionProvider";

export default function Root() {
  return <AppSessionProvider><StatusBar style="auto" /><Slot /></AppSessionProvider>;
}
