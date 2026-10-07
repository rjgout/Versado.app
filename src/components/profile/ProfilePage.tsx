"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Footer from "@/components/Footer";
import { isProfileOverview, parseProfileView } from "@/lib/profileViews";

/**
 * De shell van elke profielpagina: het overzicht (/profile), de onderdelen
 * (/profile?view=...) en de losse profielpagina's (wachtwoord, feedback).
 * Zie docs/PROFIEL.md.
 *
 * - Breedte: max-w-3xl, voor overzicht én instellingen gelijk, zodat je bij
 *   het openen van een onderdeel niet van breedte wisselt. Bewust smaller
 *   dan de standaard 5xl: instellingen en lijsten met rijen worden op een
 *   breed scherm anders lange, lege balken.
 * - De kop ("← Titel") komt uit SubpageBackBar (lijst van profielpagina's in
 *   src/lib/profileViews.ts en PROFILE_SUBPAGES); hier staat de titel alleen
 *   voor schermlezers, zodat hij niet dubbel in beeld staat.
 * - Footer: alleen op het overzicht (/profile). Onderdelen en losse
 *   profielpagina's tonen hem niet; dat volgt uit de route (isProfileOverview),
 *   zodat een nieuw onderdeel zonder eigen uitzondering zonder footer start.
 *   Op het overzicht staat hij onderaan het scherm op een korte pagina, na de
 *   inhoud op een lange (page-fill + mt-auto, zie globals.css). Ruimte voor de
 *   onderbalk komt van <main> (--main-pad-bottom), niet van de pagina.
 */
export default function ProfilePage({ title, children }: { title?: string; children: ReactNode }) {
  const pathname = usePathname();
  const view = parseProfileView(useSearchParams().get("view"));
  const showFooter = isProfileOverview(pathname, view);
  return (
    <div className="page-fill mx-auto flex w-full max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-4 sm:gap-5">
        {title && <h1 className="sr-only">{title}</h1>}
        {children}
      </div>
      {showFooter && (
        <div className="mt-auto">
          <Footer variant="inline" />
        </div>
      )}
    </div>
  );
}
