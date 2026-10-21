/** Alleen door browserleveranciers beheerde pushdiensten; geen vrij configureerbare fetchbestemming. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 4096) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return false;
    return ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com"].includes(url.hostname) ||
      url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com");
  } catch { return false; }
}
