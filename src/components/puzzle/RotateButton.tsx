import { RotateCw } from "lucide-react";

/**
 * De draaiknop van de legpuzzel (alleen bij Master en een geselecteerde, niet vastgezette groep): één gedeelde knop voor Solo,
 * Samen en Tegen elkaar. 76 CSS-pixels (zoals het bordmenu rechtsonder in px, dus onafhankelijk van de tekstgrootte) met een icoon van 34 px is een ruime
 * duimmaat; linksonder, spiegelbeeld van het bordmenu rechtsonder, en in de Immersive-werktafel binnen de veilige randen.
 */
export const ROTATE_BUTTON_SIZE_PX = 76;
export const ROTATE_ICON_SIZE_PX = 34;

export default function RotateButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="btn-primary absolute bottom-3 left-3 z-10 flex min-h-[76px] min-w-[76px] items-center justify-center rounded-2xl !p-[12px] shadow-md transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100">
      <RotateCw size={ROTATE_ICON_SIZE_PX} aria-hidden="true" />
    </button>
  );
}
