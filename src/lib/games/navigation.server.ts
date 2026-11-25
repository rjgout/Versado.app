import { redirect, notFound } from "next/navigation";
import { isNativeGameRequest } from "./requestIdentity.server";

/** Dezelfde serverpoort voor web en lokaal gebundelde spelenschermen. */
export class NativeGameRedirect extends Error {
  constructor(readonly href: string) { super("game_redirect"); }
}
export class NativeGameNotFound extends Error {}
export function gameRedirect(href: string): never {
  if (isNativeGameRequest()) throw new NativeGameRedirect(href);
  return redirect(href);
}
export function gameNotFound(): never {
  if (isNativeGameRequest()) throw new NativeGameNotFound();
  return notFound();
}
