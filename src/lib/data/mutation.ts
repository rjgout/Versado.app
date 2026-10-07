"use client";

// Elke mutation legt vast welke datasets ongeldig worden: `invalidates` is
// verplicht en getypt (DataEvent uit scopes.ts, of expliciete scopes). Zo kan
// een nieuwe schrijfactie niet vergeten worden in de verversing.
import { liveData } from "./client";
import { fetchJson } from "./fetchJson";
import type { DataEvent, DataScope } from "./scopes";

export interface MutationOptions<T> {
  /** Verplicht: wat dit ongeldig maakt. */
  invalidates: DataEvent | readonly DataScope[];
  /** Optioneel: toon het antwoord direct, de server valideert daarna via invalidates. */
  onSuccess?: (result: T) => void;
}

/** Voert een schrijfactie uit en maakt daarna alleen de gekoppelde datasets ongeldig. */
export async function liveMutation<T>(run: () => Promise<T>, options: MutationOptions<T>): Promise<T> {
  const result = await run();
  options.onSuccess?.(result);
  liveData.invalidate(options.invalidates);
  return result;
}

/** JSON-POST/PUT/DELETE met dezelfde invalidatieplicht. */
export function jsonMutation<T = unknown>(url: string, init: RequestInit & { json?: unknown }, options: MutationOptions<T>): Promise<T> {
  const { json, headers, ...rest } = init;
  return liveMutation(
    () =>
      fetchJson<T>(url, {
        method: "POST",
        ...rest,
        headers: json === undefined ? headers : { "Content-Type": "application/json", ...headers },
        body: json === undefined ? rest.body : JSON.stringify(json),
      }),
    options
  );
}
