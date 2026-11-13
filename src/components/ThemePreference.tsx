"use client";

import { useT } from "@/components/I18nProvider";
import type { MessageKey } from "@/lib/i18n/core";
import { Monitor,Moon,Sun,type LucideIcon } from "lucide-react";
import { useEffect,useState } from "react";

type ThemeChoice = "system" | "light" | "dark";

// Zelfde opslag als ThemeScript.tsx: geen waarde betekent "volg het systeem".
const STORAGE_KEY = "bom-theme";

const OPTIONS: { value: ThemeChoice; label: MessageKey; icon: LucideIcon }[] = [
  { value: "system", label: "theme.system", icon: Monitor },
  { value: "light", label: "theme.light", icon: Sun },
  { value: "dark", label: "theme.dark", icon: Moon },
];

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Weergave: systeem, licht of donker, als compacte keuzeschakelaar. */
export default function ThemePreference() {
  const t = useT();
  // Pas na het laden bekend (localStorage); tot dan staat er geen keuze
  // gemarkeerd in plaats van een mogelijk verkeerde.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    setChoice(readThemeChoice());
  }, []);

  function select(next: ThemeChoice) {
    setChoice(next);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage kan geblokkeerd zijn; dan geldt de keuze alleen nu.
    }
    const dark = next === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : next === "dark";
    document.documentElement.classList.toggle("dark", dark);
  }

  return (
    <div role="radiogroup" aria-label={t("theme.appearance")} className="grid grid-cols-3 gap-1 rounded-xl bg-vs-subtle p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => select(value)}
            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${
              active ? "bg-vs-surface text-vs-fg shadow-sm" : "text-vs-fg-2 hover:text-vs-fg"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {t(label)}
          </button>
        );
      })}
    </div>
  );
}
