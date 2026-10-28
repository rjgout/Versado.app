import { recordMailOpen } from "@/lib/mailHistory";

const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
function response() {
  return new Response(pixel, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, private, max-age=0", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await recordMailOpen(token).catch(() => {});
  // Altijd dezelfde pixel; nooit onthullen of een mail/adres bestaat.
  return response();
}
export async function HEAD() { return response(); }
