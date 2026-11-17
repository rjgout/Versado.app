import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const person = (id: string, handle: string) => ({ id, handle, discriminator: "01", avatarEmoji: null });
const data = () => ({ friends: [], incoming: [{ friendshipId: "fr1", from: person("u2", "Bob") }], outgoing: [] });
const calls: string[] = [];
let mockAcceptStatus = 200;
let mockListener: (() => void) | null = null;
const mockGameFetch = jest.fn(async (url: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? "GET"} ${url}`);
  if (url.endsWith("/accept")) { await new Promise(r => setTimeout(r, 30)); return new Response("{}", { status: mockAcceptStatus }); }
  return new Response(JSON.stringify(data()), { status: 200 });
});
const mockCtx = { session: { gameFetch: mockGameFetch, onFriendsChanged: (l: () => void) => { mockListener = l; return () => { mockListener = null; }; } } };
jest.mock("@poc/core/AppSessionProvider", () => ({
  useAppSession: () => mockCtx,
}));
import Vrienden from "../src/app/(tabs)/vrienden";

beforeEach(() => { calls.length = 0; mockAcceptStatus = 200; mockGameFetch.mockClear(); });

test("toont het inkomende verzoek met toegankelijke knop", async () => {
  await render(<Vrienden />);
  expect(await screen.findByLabelText("Verzoek van Bob accepteren")).toBeTruthy();
});

test("dubbel tikken stuurt één accept-verzoek en de knop is tijdens het verzoek bezig/uitgeschakeld", async () => {
  await render(<Vrienden />);
  const button = await screen.findByLabelText("Verzoek van Bob accepteren");
  await fireEvent.press(button);
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(screen.getByLabelText("Verzoek van Bob accepteren").props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  await waitFor(() => expect(calls.filter(c => c.startsWith("POST")).length).toBe(1));
  expect(calls.filter(c => c.startsWith("POST"))).toEqual(["POST /api/friends/fr1/accept"]);
  // Na het accepteren herlaadt het scherm de lijst; wacht daarop zodat dat verzoek niet in de volgende test valt.
  await waitFor(() => expect(calls.filter(c => c === "GET /api/friends").length).toBeGreaterThanOrEqual(2));
});

test("een realtime-signaal laadt de lijst opnieuw", async () => {
  await render(<Vrienden />);
  await screen.findByLabelText("Verzoek van Bob accepteren");
  // Eerst laten rusten: pas tellen als er geen laadverzoek meer onderweg is.
  await act(async () => { await new Promise(r => setTimeout(r, 100)); });
  const before = calls.filter(c => c === "GET /api/friends").length;
  await act(async () => { mockListener!(); });
  await waitFor(() => expect(calls.filter(c => c === "GET /api/friends").length).toBe(before + 1));
});

test("een mislukte actie toont een melding in plaats van te crashen", async () => {
  mockAcceptStatus = 500;
  await render(<Vrienden />);
  await fireEvent.press(await screen.findByLabelText("Verzoek van Bob accepteren"));
  expect(await screen.findByText("Accepteren mislukt. Probeer het opnieuw.")).toBeTruthy();
});
