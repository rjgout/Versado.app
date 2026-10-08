"use client";

import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import ToggleSwitch from "@/components/versado/ToggleSwitch";

// Gedeelde bouwstenen voor profielpagina's en instellingen (zie
// docs/PROFIEL.md). Alles met de vs-tokens, dus licht en donker vanzelf
// goed. Een nieuwe instelling is een combinatie hiervan binnen ProfilePage,
// zonder eigen kaart-, rij- of formulierstijl.
//
// Maatvoering: rijen zijn minstens 56 px hoog (min-h-14), knoppen en velden
// 44 px (min-h-11): ruim genoeg om te tikken, zonder dat het element zelf
// groot oogt. Rijen hebben px-2 binnen een kaart met p-4: de hoverkleur
// loopt dan bijna tot de rand, de tekst staat op één lijn met de kop.

const FIELD_BASE =
  "block max-w-full min-h-11 rounded-xl border border-vs-line-strong bg-vs-surface px-3 py-2 text-base text-vs-fg placeholder:text-vs-fg-3 transition focus:border-vs-accent focus:outline-none focus:ring-2 focus:ring-vs-accent/25 disabled:cursor-not-allowed disabled:opacity-60 dark:[color-scheme:dark] sm:text-sm";

/** Veldstijl voor invoer, tekstvakken en keuzelijsten (AppSelect): volle breedte. */
export const settingsFieldClass = `${FIELD_BASE} w-full`;

/** Dezelfde stijl, zo breed als de inhoud: een tijd of snelheid naast het label (SettingsField inline). */
export const settingsInlineFieldClass = `${FIELD_BASE} w-auto`;

/** Kaart van een profielpagina, met optioneel een kleine kop en uitleg. */
export function ProfileCard({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Knoppen onder de inhoud (of in plaats van inhoud), met vaste afstand. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className={`rounded-2xl border border-vs-line bg-vs-surface p-4 sm:p-5 ${className}`}>
      {title && (
        <h2 id={id} className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-vs-fg-2">
          {title}
        </h2>
      )}
      {description && <p className={`text-sm text-vs-fg-2 ${title ? "mt-1" : ""}`}>{description}</p>}
      {children !== undefined && children !== null && children !== false && (title || description ? <div className="mt-2">{children}</div> : children)}
      {actions && <div className={`flex flex-wrap items-center gap-2 ${title || description || children ? "mt-4" : ""}`}>{actions}</div>}
    </section>
  );
}

/** Een groep instellingen: kaart met rijen, gescheiden door een dunne lijn. */
export function SettingsSection({ title, description, children }: { title?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <ProfileCard title={title} description={description}>
      <div className="divide-y divide-vs-line">{children}</div>
    </ProfileCard>
  );
}

// Met een waarde ernaast (`hasValue`) is het label precies zo breed als zijn
// tekst en vult de waarde de rest (zie SettingsRow); zonder waarde vult het
// label de rij. Zo krimpt een label als "Leesvoortgang" nooit een fractie
// van een pixel, waardoor de laatste letter zou afbreken.
function RowText({ label, description, descriptionId, hasValue = false }: { label: ReactNode; description?: ReactNode; descriptionId?: string; hasValue?: boolean }) {
  return (
    <span className={`min-w-0 ${hasValue ? "flex-[0_1_auto]" : "flex-auto"}`}>
      {/* Op een heel smal scherm (320 px) past een lang woord als
          "Tweestapsverificatie" soms niet: dan afbreken (met streepje waar de
          browser de taal kent) in plaats van over de waarde heen. */}
      <span className="block hyphens-auto break-words font-bold text-vs-fg">{label}</span>
      {description && (
        <span id={descriptionId} className="block text-sm text-vs-fg-2">
          {description}
        </span>
      )}
    </span>
  );
}

const ROW_CLASS = "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left";
const INTERACTIVE_ROW = "transition hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent";

/** Rij die ergens heen gaat (link of onderdeel): icoon, label, waarde, pijl. */
export function SettingsRow({
  icon,
  label,
  description,
  value,
  href,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const hasValue = value !== undefined && value !== null;
  const content = (
    <>
      {icon && <span className="shrink-0">{icon}</span>}
      <RowText label={label} description={description} hasValue={hasValue} />
      {/* Het label gaat voor: de waarde begint op nul breedte, vult wat er
          overblijft en kort zichzelf in, nooit andersom. */}
      {hasValue && <span className="min-w-0 flex-1 truncate text-right text-sm text-vs-fg-2">{value}</span>}
      <ChevronRight className="h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`${ROW_CLASS} ${INTERACTIVE_ROW}`}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${ROW_CLASS} ${INTERACTIVE_ROW}`}>
      {content}
    </button>
  );
}

/** Rij die alleen iets laat zien (status, tijdzone): geen pijl, niet klikbaar. */
export function SettingsInfoRow({ icon, label, description, value }: { icon?: ReactNode; label: ReactNode; description?: ReactNode; value?: ReactNode }) {
  return (
    <div className={ROW_CLASS}>
      {icon && <span className="shrink-0">{icon}</span>}
      <RowText label={label} description={description} />
      {value !== undefined && value !== null && <span className="shrink-0 text-sm font-bold text-vs-fg-2">{value}</span>}
    </div>
  );
}

/**
 * Aan/uit-instelling: de hele rij is het label van een echte checkbox met
 * role="switch", de schakelaar is alleen beeld. `disabled` is voor iets dat
 * niet kan (zet in de beschrijving waarom) en oogt ook zo. `busy` is voor
 * "wordt opgeslagen": dan telt een tik niet, maar het veld blijft
 * focusbaar. Een disabled veld verliest de toetsenbordfocus, en dan werkt
 * een tweede spatie niet meer.
 */
export function SettingsToggleRow({
  icon,
  label,
  description,
  checked,
  disabled = false,
  busy = false,
  onChange,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: () => void;
}) {
  const descriptionId = useId();
  return (
    <label className={`${ROW_CLASS} ${disabled ? "cursor-not-allowed" : "cursor-pointer transition hover:bg-vs-subtle"}`}>
      {icon && <span className={`shrink-0 ${disabled ? "opacity-50" : ""}`}>{icon}</span>}
      <span className={`min-w-0 flex-auto ${disabled ? "opacity-60" : ""}`}>
        <RowText label={label} description={description} descriptionId={description ? descriptionId : undefined} />
      </span>
      <ToggleSwitch
        checked={checked}
        disabled={disabled}
        busy={busy}
        onChange={onChange}
        ariaDescribedBy={description ? descriptionId : undefined}
      />
    </label>
  );
}

/**
 * Instelling met een eigen bediening onder het label (keuzelijst, invoer,
 * knoppen). Met `inline` staat een kleine bediening (tijd, snelheid) rechts
 * naast het label. Geef `htmlFor` mee als de bediening een eigen id heeft;
 * een AppSelect krijgt zijn naam via ariaLabel.
 */
export function SettingsField({
  label,
  description,
  htmlFor,
  inline = false,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  inline?: boolean;
  children: ReactNode;
}) {
  const labelNode = htmlFor ? (
    <label htmlFor={htmlFor} className="block font-bold text-vs-fg">
      {label}
    </label>
  ) : (
    <span className="block font-bold text-vs-fg">{label}</span>
  );
  if (inline) {
    return (
      // Bij grotere tekst past de bediening niet meer naast het label: dan komt ze eronder (reflow).
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2">
        <div className="min-w-[min(100%,9rem)] flex-1">
          {labelNode}
          {description && <p className="text-sm text-vs-fg-2">{description}</p>}
        </div>
        <div className="max-w-full shrink-0">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-2 py-3">
      <div>
        {labelNode}
        {description && <p className="text-sm text-vs-fg-2">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Ruimte voor knoppen of een melding onder rijen, op één lijn met de rijen. */
export function SettingsActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-2 py-3">{children}</div>;
}

const BUTTON_VARIANTS = {
  primary: "bg-vs-accent text-vs-on-accent hover:opacity-90",
  secondary: "border border-vs-line-strong bg-vs-surface text-vs-fg hover:bg-vs-subtle",
  danger: "border border-vs-danger/40 bg-vs-surface text-vs-danger hover:bg-vs-danger-soft",
  // Klein en zonder rand: een onomkeerbare actie die niet tussen gewone
  // instellingen hoort te concurreren (account verwijderen).
  quietDanger: "text-vs-danger hover:bg-vs-danger-soft",
} as const;

/** Knop voor profielpagina's: compact, 44 px hoog, in de stijl van de rijen. */
export function SettingsButton({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vs-surface disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

const STATUS = {
  info: { icon: Info, className: "text-vs-fg-2", box: "bg-vs-subtle" },
  success: { icon: CheckCircle2, className: "text-vs-success", box: "bg-vs-success-soft" },
  warning: { icon: AlertTriangle, className: "text-vs-warning", box: "bg-vs-warning-soft" },
  error: { icon: AlertCircle, className: "text-vs-danger", box: "bg-vs-danger-soft" },
} as const;

/**
 * Korte status of melding: rustig, met icoon. Fouten worden voorgelezen
 * (role="alert"), de rest als status. `boxed` geeft een zacht vlak, voor
 * iets dat je niet mag missen (een geforceerde wachtwoordwijziging).
 */
export function SettingsStatus({ kind = "info", boxed = false, children }: { kind?: keyof typeof STATUS; boxed?: boolean; children: ReactNode }) {
  const { icon: Icon, className, box } = STATUS[kind];
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 text-sm ${className} ${boxed ? `rounded-xl px-3 py-2 ${box}` : ""}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
