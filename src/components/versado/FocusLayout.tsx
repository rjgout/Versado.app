import type { ReactNode } from "react";

interface FocusLayoutProps {
  children: ReactNode;
  className?: string;
}

/**
 * Het canvas voor een activiteit. De app-shell bepaalt wanneer header en
 * bottomnav verdwijnen; deze component bepaalt alleen de inhoudelijke maat,
 * veilige hoogte en verticale ruimte van de activiteit zelf.
 */
export default function FocusLayout({ children, className = "" }: FocusLayoutProps) {
  return (
    <div className={`vs-focus-layout vs-motion mx-auto flex min-h-[calc(100dvh-var(--header-height,4.5rem)-1rem)] w-full max-w-4xl flex-col ${className}`}>
      {children}
    </div>
  );
}
