import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { NativeClientError } from "@/lib/native/client";

let mockRestore = jest.fn();
let mockToday = jest.fn();
jest.mock("expo-router", () => ({ Redirect: ({ href }: { href: string }) => { const { Text: T } = require("react-native"); return <T testID="redirect">{href}</T>; } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("@poc/core/secureStore", () => ({ secureSessionStore: {} }));
jest.mock("@poc/core/session", () => ({
  createAppSession: () => ({
    client: { restore: (...a: unknown[]) => mockRestore(...a), onSessionChange: () => () => {} },
    today: (...a: unknown[]) => mockToday(...a),
    actor: () => ({ id: "u1" }),
    signIn: async () => {},
    signOut: async () => {},
  }),
}));
import Index from "../src/app/index";
import { AppSessionProvider, isTransientStartupError } from "../src/core/AppSessionProvider";

const ui = () => <AppSessionProvider><Index /></AppSessionProvider>;
beforeEach(() => { mockRestore = jest.fn(); mockToday = jest.fn(); });

test("een netwerkfout bij het opstarten is geen uitlog: herstelscherm, geen inlogscherm", async () => {
  mockRestore.mockRejectedValue(new NativeClientError("network_unavailable"));
  await render(ui());
  expect(await screen.findByText("Geen verbinding")).toBeTruthy();
  expect(screen.queryByTestId("redirect")).toBeNull();
});

test("een serverfout (5xx) bij het herstellen telt ook als tijdelijk", async () => {
  mockRestore.mockRejectedValue(new NativeClientError("request_failed", 503));
  await render(ui());
  expect(await screen.findByText("Geen verbinding")).toBeTruthy();
});

test("'Opnieuw proberen' herstelt de sessie zodra de verbinding terug is en gaat naar Vandaag", async () => {
  mockRestore.mockRejectedValueOnce(new NativeClientError("network_unavailable")).mockResolvedValue(true);
  mockToday.mockResolvedValue({ userId: "u1" });
  await render(ui());
  await fireEvent.press(await screen.findByTestId("retry-connection"));
  await waitFor(() => expect(screen.getByTestId("redirect")).toHaveTextContent("/vandaag"));
});

test("een door de server afgewezen sessie (401) of een ontbrekende sessie leidt wél naar inloggen", async () => {
  mockRestore.mockRejectedValue(new NativeClientError("session_expired", 401));
  const first = await render(ui());
  await waitFor(() => expect(screen.getByTestId("redirect")).toHaveTextContent("/login"));
  first.unmount();
  mockRestore.mockResolvedValue(false);
  await render(ui());
  await waitFor(() => expect(screen.getByTestId("redirect")).toHaveTextContent("/login"));
});

test("een tijdelijke fout wordt herkend op code, status 0 en 5xx, niet op 401/400", () => {
  expect(isTransientStartupError(new NativeClientError("network_unavailable"))).toBe(true);
  expect(isTransientStartupError(new NativeClientError("x", 0))).toBe(true);
  expect(isTransientStartupError(new NativeClientError("x", 502))).toBe(true);
  expect(isTransientStartupError(new NativeClientError("session_expired", 401))).toBe(false);
  expect(isTransientStartupError(new NativeClientError("x", 400))).toBe(false);
  expect(isTransientStartupError(new Error("boom"))).toBe(false);
});

void Text;
