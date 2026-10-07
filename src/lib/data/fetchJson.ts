// Gedeelde ophaalfunctie voor de live-data-laag: altijd vers van het netwerk
// (de eigen cache van de store bepaalt wanneer opnieuw), en met de
// foutmelding van de server als die er is.
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }
  return body as T;
}
