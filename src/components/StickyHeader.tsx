/**
 * De vaste bovenbalk van de shell: header, terugbalk en spelers samen in één
 * wrapper. Bewust `position: fixed` en geen `sticky`: sticky heeft op iOS
 * Safari een bekende weergavefout zodra de adresbalk inklapt (de balk
 * verdwijnt dan mee tot je weer omhoog scrolt), en fixed valt niet buiten een
 * te kort omvattend blok (body). De hoogte meet ShellMetrics en zet hij als
 * --header-height; <main> houdt daarmee precies evenveel ruimte vrij als de
 * balk inneemt. Bij zeer grote tekst (html[data-header-tall]) scrolt de balk
 * mee, zie globals.css. Alle schermen, ook focus mode, gebruiken dit ene model.
 */
export default function StickyHeader({ children }: { children: React.ReactNode }) {
  return (
    <div data-sticky-header className="fixed top-0 inset-x-0 z-20">
      {children}
    </div>
  );
}
