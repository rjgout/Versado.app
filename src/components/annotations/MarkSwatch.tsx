import { Check } from "lucide-react";
import type { AnnotationColor } from "@/lib/annotations/clientContract";

/**
 * Kleurindicatie van een markering (kleuren per thema in globals.css). Altijd naast de kleurnaam gebruiken:
 * kleur is nooit het enige signaal. `checked` toont een vinkje voor de gekozen kleur.
 */
export default function MarkSwatch({ color, checked = false, className = "" }: { color: AnnotationColor; checked?: boolean; className?: string }) {
  return (
    <span aria-hidden data-mark-swatch={color} className={`mark-swatch ${className}`}>
      {checked && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
    </span>
  );
}
