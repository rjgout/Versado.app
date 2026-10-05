import type { ReactNode } from "react";

/**
 * Viewportcanvas voor arcade/gameplay. Welke route immersive is, blijft een
 * centrale shellbeslissing in focusMode.ts; deze component regelt uitsluitend
 * de veilige, viewportvullende inhoud zonder eigen chrome-hacks.
 */
export default function ImmersiveLayout({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`vs-immersive-layout vs-motion flex min-h-[100dvh] w-full ${className}`}>{children}</div>;
}
