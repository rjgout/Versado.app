import { NextRequest, NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/baseUrl";
import { verifyUnsubscribeToken, unsubscribePageUrl } from "@/lib/unsubscribe";
import { applyUnsubscribe, type UnsubscribeAction } from "@/lib/unsubscribeActions";

// Het enige adres dat een uitschrijving doorvoert. Bewust alleen POST: een GET (een mailscanner,
// een voorbeeldweergave) wijzigt nooit iets en stuurt door naar de bevestigingspagina.
// Het token is zelf de machtiging (ondertekend, niet te raden), dus geen sessie nodig en ook
// geen apart CSRF-token: een aanvaller zonder het token kan niets. Er wordt bewust niets gelogd
// van token of e-mailadres, en een fout lekt geen inhoud.

function tokenFrom(req: NextRequest, form: FormData | null): string {
  const fromForm = form?.get("token");
  return typeof fromForm === "string" && fromForm ? fromForm : (req.nextUrl.searchParams.get("t") ?? "");
}

export async function GET(req: NextRequest) {
  const base = getBaseUrl(req);
  const token = req.nextUrl.searchParams.get("t") ?? "";
  return NextResponse.redirect(token ? unsubscribePageUrl(base, token) : base, 303);
}

export async function POST(req: NextRequest) {
  const base = getBaseUrl(req);
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const token = tokenFrom(req, form);
  // RFC 8058: de mailclient stuurt "List-Unsubscribe=One-Click" en verwacht een gewoon antwoord, geen doorverwijzing.
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const verified = verifyUnsubscribeToken(token);

  if (!verified) {
    return oneClick ? new NextResponse(null, { status: 400 }) : NextResponse.redirect(token ? unsubscribePageUrl(base, token) : base, 303);
  }

  // De handeling komt uit het formulier en wordt streng gevalideerd; een één-klik vanuit de
  // mailclient betekent "dit soort meldingen". De categorie zelf komt uitsluitend uit het token.
  const requested = form?.get("actie");
  const action: UnsubscribeAction = requested === "all" ? "all" : "category";

  try {
    await applyUnsubscribe(verified.userId, verified.category, action);
  } catch {
    return oneClick ? new NextResponse(null, { status: 500 }) : NextResponse.redirect(`${unsubscribePageUrl(base, token, action)}${action === "all" ? "&" : "?"}fout=1`, 303);
  }
  if (oneClick) return new NextResponse("OK", { status: 200 });
  return NextResponse.redirect(`${unsubscribePageUrl(base, token, action)}${action === "all" ? "&" : "?"}klaar=1`, 303);
}
